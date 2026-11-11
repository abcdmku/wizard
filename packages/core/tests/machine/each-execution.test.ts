import { describe, expect, it } from 'vitest'
import type { EachSpec } from '../../src/authoring/compiled'
import { eachItem } from '../../src/machine/each-state'
import type { CallEffect } from '../../src/machine/effects'
import type { WizardState } from '../../src/machine/state'
import { createHarness, flow, type Harness, of, replay, runStep } from '../helpers/fixtures'

const each: EachSpec = { items: () => [], concurrency: 2 }

function itemCall(h: Harness, index: number): CallEffect {
  const call = h.pending('run', 'map').find((effect) => effect.token.itemIndex === index)
  if (call === undefined) throw new Error(`no pending item call for ${index}`)
  return call
}

function startItems(h: Harness, items: readonly unknown[]): void {
  h.start()
  expect(h.pending('run', 'map')).toEqual([])
  h.ok(h.call('each', 'map'), { items, keys: items.map((_, index) => `key-${index}`) })
}

function itemIndices(calls: readonly CallEffect[]): (number | undefined)[] {
  return calls.map((call) => call.token.itemIndex)
}

describe('map item execution', () => {
  it('bounds concurrency and assembles outputs in input order after out-of-order completions', () => {
    const h = createHarness(flow({ start: 'map', steps: { map: runStep({ each }) } }))
    startItems(h, ['a', 'b', 'c', 'd'])
    expect(itemIndices(h.pending('run', 'map'))).toEqual([0, 1])
    expect(h.rec('map').each).toMatchObject({ cursor: 2, running: 2, done: 0 })
    expect(itemCall(h, 1).extra).toMatchObject({
      item: 'b',
      index: 1,
      attempt: 1,
      idempotencyKey: 'inst-1:map:1:key-1',
    })

    for (const [index, expectedPending] of [
      [1, [0, 2]],
      [2, [0, 3]],
      [0, [3]],
      [3, []],
    ] as const) {
      h.ok(itemCall(h, index), `${index}-done`)
      expect(itemIndices(h.pending('run', 'map'))).toEqual(expectedPending)
      expect(h.rec('map').each?.running).toBeLessThanOrEqual(2)
    }

    expect(h.rec('map')).toMatchObject({
      status: 'done',
      output: ['0-done', '1-done', '2-done', '3-done'],
      each: { running: 0, done: 4 },
    })
    h.step({ type: 'settle' })
    expect(h.state.status).toBe('done')
    expect(h.state.output).toEqual(['0-done', '1-done', '2-done', '3-done'])
    expect(replay(h)).toEqual(h.state)
  })

  it('keeps successful items when a failed item is manually retried', () => {
    const h = createHarness(flow({ start: 'map', steps: { map: runStep({ each }) } }))
    startItems(h, ['a', 'b', 'c'])
    h.ok(itemCall(h, 0), 'A')
    h.ok(itemCall(h, 1), 'B')
    h.err(itemCall(h, 2), 'C failed')
    expect(h.state.status).toBe('halted')
    const successful = [eachItem(h.rec('map').each!, 0), eachItem(h.rec('map').each!, 1)]

    const retried = h.cmd({ type: 'retry', step: 'map' })
    expect(of(retried, 'step.eachRetryRequested')[0]?.indices).toEqual([2])
    expect(itemIndices(h.pending('run', 'map'))).toEqual([2])
    expect(h.pending('each', 'map')).toEqual([])
    expect(h.state.status).toBe('running')
    expect(h.rec('map').error).toBeUndefined()
    expect(eachItem(h.rec('map').each!, 0)).toBe(successful[0])
    expect(eachItem(h.rec('map').each!, 1)).toBe(successful[1])

    h.ok(itemCall(h, 2), 'C')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: ['A', 'B', 'C'] })
    expect(replay(h)).toEqual(h.state)
  })

  it('preserves per-item attempts through retry timers and exhausts the configured retry limit', () => {
    const h = createHarness(
      flow({
        start: 'map',
        steps: { map: runStep({ each, retry: { retries: 1, backoff: 25 } }) },
      }),
    )
    startItems(h, ['a', 'b'])
    const first = itemCall(h, 0)
    h.ok(itemCall(h, 1), 'B')
    const failed = h.err(first, 'first failure')
    const scheduled = of(failed, 'step.eachRetryScheduled')[0]!
    expect(scheduled).toMatchObject({ index: 0, attempt: 2, dueAt: h.clock.now + 25 })
    expect(eachItem(h.rec('map').each!, 0)).toMatchObject({
      status: 'retrying',
      attempt: 1,
      retryAt: scheduled.dueAt,
    })
    expect(h.pending('run', 'map')).toEqual([])

    h.clock.advance(25)
    h.fire(scheduled.timerId)
    const second = itemCall(h, 0)
    expect(second.token.attempt).toBe(2)
    expect(second.extra?.idempotencyKey).toBe(first.extra?.idempotencyKey)
    expect(eachItem(h.rec('map').each!, 0).retryAt).toBeUndefined()
    expect(h.state.timers).toEqual({})
    const exhausted = h.err(second, 'last failure')
    expect(of(exhausted, 'step.eachRetryScheduled')).toEqual([])
    expect(of(exhausted, 'step.eachItemFailed')[0]).toMatchObject({
      index: 0,
      attempt: 2,
      willRetry: false,
    })
    expect(h.state.status).toBe('halted')
    expect(eachItem(h.rec('map').each!, 1)).toMatchObject({ status: 'done', output: 'B' })
    expect(replay(h)).toEqual(h.state)
  })

  it('resumes unfinished idempotent items from a JSON snapshot without rerunning completed items', () => {
    const def = flow({ start: 'map', steps: { map: runStep({ each, idempotent: true }) } })
    const original = createHarness(def)
    startItems(original, ['a', 'b', 'c'])
    const unfinished = itemCall(original, 1)
    original.ok(itemCall(original, 0), 'A')
    const h = createHarness(def)
    h.state = JSON.parse(JSON.stringify(original.state)) as WizardState
    h.log.push(...original.log)

    const resumed = h.step({ type: 'resume', fromSeq: h.state.seq })
    const calls = resumed.effects.filter((effect): effect is CallEffect => effect.kind === 'call')
    expect(calls.every((call) => call.hook === 'run')).toBe(true)
    expect(itemIndices(calls)).toEqual([1, 2])
    expect(calls[0]?.token).toEqual(unfinished.token)
    expect(calls[0]?.extra?.idempotencyKey).toBe(unfinished.extra?.idempotencyKey)
    expect(of(resumed, 'step.eachItemStarted').every((event) => event.resumed === true)).toBe(true)
    expect(eachItem(h.rec('map').each!, 0)).toMatchObject({ status: 'done', output: 'A' })
    expect(h.rec('map').each).toMatchObject({ running: 2, done: 1 })

    h.ok(itemCall(h, 2), 'C')
    h.ok(itemCall(h, 1), 'B')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: ['A', 'B', 'C'] })
    expect(replay(h)).toEqual(h.state)
  })

  it('completes an empty map with an empty output and no item calls', () => {
    const h = createHarness(flow({ start: 'map', steps: { map: runStep({ each }) } }))
    startItems(h, [])
    expect(h.pending('run', 'map')).toEqual([])
    expect(h.rec('map')).toMatchObject({
      status: 'done',
      output: [],
      each: { done: 0, running: 0 },
    })
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: [] })
    expect(replay(h)).toEqual(h.state)
  })

  it('ignores duplicates and older item attempts without overwriting successful output', () => {
    const h = createHarness(
      flow({ start: 'map', steps: { map: runStep({ each, retry: { retries: 1 } }) } }),
    )
    startItems(h, ['a', 'b'])
    const first = itemCall(h, 0)
    const finished = itemCall(h, 1)
    h.ok(finished, 'B')
    expect(h.ok(finished, 'duplicate B').types).toEqual(['result.ignored'])
    h.err(first, 'retry A')
    h.fire('each-retry:map:0')
    const second = itemCall(h, 0)
    expect(second.token.attempt).toBe(2)
    expect(h.ok(first, 'stale A').types).toEqual(['result.ignored'])
    expect(eachItem(h.rec('map').each!, 0)).toMatchObject({ status: 'running', attempt: 2 })
    h.ok(second, 'A')
    expect(h.ok(second, 'duplicate A').types).toEqual(['result.ignored'])
    expect(h.rec('map').output).toEqual(['A', 'B'])
    expect(replay(h)).toEqual(h.state)
  })

  it('ignores an older item result after a manual retry starts a new item attempt', () => {
    const h = createHarness(flow({ start: 'map', steps: { map: runStep({ each }) } }))
    startItems(h, ['a'])
    const first = itemCall(h, 0)
    h.err(first, 'first failure')
    h.cmd({ type: 'retry', step: 'map' })
    const retry = itemCall(h, 0)

    expect(h.ok(first, 'stale success').types).toEqual(['result.ignored'])
    expect(eachItem(h.rec('map').each!, 0).status).toBe('running')
    h.ok(retry, 'fresh success')
    h.step({ type: 'settle' })
    expect(h.state).toMatchObject({ status: 'done', output: ['fresh success'] })
  })
})
