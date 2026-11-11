import { describe, expect, it } from 'vitest'
import {
  createEachState,
  type EachState,
  eachItem,
  eachOutputs,
  updateEachItem,
} from '../../src/machine/each-state'
import type { StepError } from '../../src/machine/state'

const failure: StepError = { kind: 'run', name: 'Error', message: 'try again', at: 10 }

function roundtrip(state: EachState): EachState {
  return JSON.parse(JSON.stringify(state)) as EachState
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeTree(child)
  Object.freeze(value)
}

function tableNodes(state: EachState): Set<object> {
  const nodes = new Set<object>()
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    nodes.add(value)
    for (const child of Object.values(value)) visit(child)
  }
  visit(state.records.root)
  return nodes
}

describe('persisted map item state', () => {
  it('snapshots the input arrays and keeps unstarted items implicit', () => {
    const items = ['a', 'b']
    const keys = ['key-a', 'key-b']
    const state = createEachState(items, keys)
    items.push('c')
    keys[0] = 'changed'

    expect(state.items).toEqual(['a', 'b'])
    expect(state.keys).toEqual(['key-a', 'key-b'])
    expect(state).toMatchObject({ cursor: 0, running: 0, done: 0 })
    expect(eachItem(state, 0)).toEqual({ status: 'pending', attempt: 0 })
    expect(eachItem(state, 1)).toEqual({ status: 'pending', attempt: 0 })
    expect(state.records.root).toEqual({ items: [] })
    expect(roundtrip(state)).toEqual(state)
  })

  it('keeps every published version unchanged across leaves and branches', () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index)
    const initial = createEachState(items, items.map(String))
    const versions = [initial]
    const indices = [0, 63, 64, 2047, 2048, 9999]
    for (const index of indices) {
      const before = versions[versions.length - 1]!
      freezeTree(before)
      versions.push(updateEachItem(before, index, { status: 'done', attempt: 1, output: index }))
    }

    for (const [versionIndex, version] of versions.entries()) {
      for (const [itemIndex, index] of indices.entries()) {
        expect(eachItem(version, index).status).toBe(itemIndex < versionIndex ? 'done' : 'pending')
      }
      expect(roundtrip(version)).toEqual(version)
    }
  })

  it('updates item retry facts without discarding successful items', () => {
    let state = createEachState(['a', 'b'], ['a', 'b'])
    state = updateEachItem(state, 0, { status: 'done', attempt: 1, output: 'A' })
    state = updateEachItem(state, 1, { status: 'failed', attempt: 2, error: failure })
    const failed = state
    state = updateEachItem(state, 1, { status: 'retrying', retryAt: 100 })
    const persisted = roundtrip(state)

    expect(eachItem(persisted, 1)).toEqual({
      status: 'retrying',
      attempt: 2,
      error: failure,
      retryAt: 100,
    })
    state = updateEachItem(persisted, 1, {
      status: 'running',
      attempt: 3,
      error: undefined,
      retryAt: undefined,
    })
    state = updateEachItem(state, 1, { status: 'done', output: 'B' })

    expect(eachOutputs(state)).toEqual(['A', 'B'])
    expect(eachItem(state, 1)).toEqual({ status: 'done', attempt: 3, output: 'B' })
    expect(eachItem(failed, 1)).toEqual({ status: 'failed', attempt: 2, error: failure })
    expect(roundtrip(state)).toEqual(state)
  })

  it('preserves child summaries when later item facts arrive', () => {
    const child = { status: 'waiting', current: 'approval', progress: 0.5, seq: 7 } as const
    let state = createEachState(['a'], ['a'])
    state = updateEachItem(state, 0, { status: 'running', attempt: 1, child })
    state = updateEachItem(roundtrip(state), 0, { status: 'done', output: { approved: true } })

    expect(eachItem(state, 0).child).toEqual(child)
    expect(eachOutputs(state)).toEqual([{ approved: true }])
  })

  it('returns input-order results for out-of-order completions', () => {
    let state = createEachState([0, 1, 2], ['0', '1', '2'])
    for (const index of [2, 0, 1]) {
      state = updateEachItem(state, index, { status: 'done', attempt: 1, output: `item-${index}` })
    }
    expect(eachOutputs(roundtrip(state))).toEqual(['item-0', 'item-1', 'item-2'])
  })

  it('reads sparse outputs at every trie-depth boundary', () => {
    for (const length of [1, 64, 65, 2048, 2049, 65536, 65537]) {
      const items = Array.from({ length }, (_, index) => index)
      let state = createEachState(items, items.map(String))
      state = updateEachItem(state, length - 1, {
        status: 'done',
        attempt: 1,
        output: 'last',
      })
      const outputs = eachOutputs(roundtrip(state))
      expect(outputs).toHaveLength(length)
      expect(outputs[length - 1]).toBe('last')
      if (length > 1) expect(outputs[0]).toBeUndefined()
      expect(eachItem(state, length - 1).output).toBe('last')
    }
  })

  it('keeps counters unchanged for the event reducer to manage', () => {
    const state = { ...createEachState([0], ['0']), cursor: 1, running: 1, done: 0 }
    const next = updateEachItem(state, 0, { status: 'done', attempt: 1, output: 0 })
    expect(next).toMatchObject({ cursor: 1, running: 1, done: 0 })
    expect(next.items).toBe(state.items)
    expect(next.keys).toBe(state.keys)
  })

  it('ignores malformed indices and avoids copies for unchanged patches', () => {
    const state = createEachState([0], ['0'])
    for (const index of [-1, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateEachItem(state, index, { status: 'done' })).toBe(state)
      expect(eachItem(state, index)).toEqual({ status: 'pending', attempt: 0 })
    }
    expect(updateEachItem(state, 0, {})).toBe(state)
    expect(updateEachItem(state, 0, { status: 'pending', attempt: 0 })).toBe(state)
    expect(eachOutputs(createEachState([], []))).toEqual([])
  })

  it('copies a bounded path per write even when many records already exist', () => {
    const length = 10_000
    const items = Array.from({ length }, (_, index) => index)
    let state = createEachState(items, items.map(String))
    for (let index = 0; index < length; index++) {
      state = updateEachItem(state, index, { status: 'done', attempt: 1, output: index })
    }
    const beforeNodes = tableNodes(state)
    const next = updateEachItem(state, 5000, { output: 'changed' })
    const copiedNodes = [...tableNodes(next)].filter((node) => !beforeNodes.has(node))

    // One record, one node and one array per level. No array has more than 64 slots.
    expect(copiedNodes).toHaveLength(1 + 2 * (state.records.depth + 1))
    for (const node of copiedNodes) {
      if (Array.isArray(node)) expect(node.length).toBeLessThanOrEqual(64)
    }
    expect(eachItem(state, 5000).output).toBe(5000)
    expect(eachItem(next, 5000).output).toBe('changed')
    expect(eachOutputs(state)).toEqual(state.items)
  })
})
