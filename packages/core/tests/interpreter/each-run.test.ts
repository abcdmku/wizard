import { describe, expect, it } from 'vitest'
import type { CompiledFlow, Hook } from '../../src/authoring/compiled'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { eachItem } from '../../src/machine/each-state'
import type { DomainEvent } from '../../src/machine/events'
import { initialState, machine } from '../../src/machine/index'
import type { WizardState } from '../../src/machine/state'
import { flow, runStep } from '../helpers/fixtures'

function mapped(
  items: Hook<readonly unknown[]>,
  run: Hook,
  extra: Partial<CompiledFlow['steps'][string]> = {},
): CompiledFlow {
  return flow({
    start: 'work',
    steps: { work: { ...runStep({ run }), each: { items, concurrency: 2 }, ...extra } },
  })
}

function runner(def: CompiledFlow, saved?: WizardState) {
  const sched = createTestScheduler({ now: 1_000 })
  const ids = createSequentialIds()
  const events: DomainEvent[] = []
  const failures: unknown[] = []
  const env = { def, path: [], now: () => sched.now(), id: (prefix: string) => ids.id(prefix) }
  const interp = createInterpreter({
    def,
    machine,
    path: [],
    env: { clock: sched, scheduler: sched, ids },
    initialState:
      saved ?? initialState(env, { instanceId: 'map-test', context: {}, now: sched.now() }),
    onEvent: (event) => events.push(event),
    onListenerError: (error) => failures.push(error),
  })
  return { interp, sched, events, failures }
}

const turn = async (): Promise<void> => {
  for (let n = 0; n < 8; n++) await Promise.resolve()
}

describe('map execution', () => {
  it('limits concurrency and returns outputs in input order with transient progress', async () => {
    const pending = new Map<number, (value: unknown) => void>()
    const started: unknown[] = []
    const def = mapped(
      () => [10, 20, 30],
      ({ item, index }) => {
        started.push(item)
        return new Promise((resolve) => pending.set(Number(index), resolve))
      },
    )
    const t = runner(def)
    t.interp.send({ type: 'start' })
    expect(started).toEqual([10, 20])
    pending.get(1)?.('second')
    await turn()
    expect(started).toEqual([10, 20, 30])
    pending.get(2)?.('third')
    pending.get(0)?.('first')
    await turn()
    expect(t.interp.getState().output).toEqual(['first', 'second', 'third'])
    expect(
      t.events
        .filter((event) => event.type === 'step.progress')
        .map((event) => ('value' in event ? event.value : undefined)),
    ).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
    expect(t.interp.log().some((event) => event.type === 'step.progress')).toBe(false)
    expect(t.failures).toEqual([])
    t.interp.dispose()
  })

  it('snapshots item objects before running so source mutations cannot change pending items', async () => {
    const source = [{ id: 1 }, { id: 2 }]
    let release: () => void = () => {}
    const seen: unknown[] = []
    const def = mapped(
      () => source,
      ({ item, index }) => {
        seen.push(item)
        return index === 0
          ? new Promise<void>((resolve) => {
              release = resolve
            })
          : item
      },
      { each: { items: () => source, concurrency: 1 } },
    )
    const t = runner(def)
    t.interp.send({ type: 'start' })
    source[1]!.id = 99
    release()
    await turn()
    expect(seen).toEqual([{ id: 1 }, { id: 2 }])
    t.interp.dispose()
  })

  it('fails invalid item lists and duplicate keys before any item runs', () => {
    let calls = 0
    const malformed = mapped(
      () => 1 as unknown as readonly unknown[],
      () => {
        calls++
        return 'bad'
      },
    )
    const duplicate = mapped(
      () => ['a', 'b'],
      () => {
        calls++
        return 'bad'
      },
      { each: { items: () => ['a', 'b'], key: () => 'same', concurrency: 2 } },
    )
    for (const [def, code] of [
      [malformed, 'EACH_INVALID'],
      [duplicate, 'EACH_DUPLICATE_KEY'],
    ] as const) {
      const t = runner(def)
      t.interp.send({ type: 'start' })
      expect(t.interp.getState().status).toBe('halted')
      expect(t.interp.getState().steps.work?.error?.code).toBe(code)
      t.interp.dispose()
    }
    expect(calls).toBe(0)
  })

  it('maps each concurrent failure independently and retries only failed items', async () => {
    const attempts = new Map<number, number>()
    const rawErrors: unknown[] = []
    const def = mapped(
      () => [0, 1, 2],
      ({ index }) => {
        const n = Number(index)
        attempts.set(n, (attempts.get(n) ?? 0) + 1)
        if (n === 1 && attempts.get(n) === 1) throw new Error('item-one')
        return `ok-${n}`
      },
      {
        hooks: {
          run: ({ index }) => {
            const n = Number(index)
            attempts.set(n, (attempts.get(n) ?? 0) + 1)
            if (n === 1 && attempts.get(n) === 1) throw new Error('item-one')
            return `ok-${n}`
          },
          mapError: ({ error, index }) => {
            rawErrors.push(error)
            return { index, message: error instanceof Error ? error.message : '' }
          },
        },
      },
    )
    const t = runner(def)
    t.interp.send({ type: 'start' })
    expect(t.interp.getState().status).toBe('halted')
    expect(rawErrors).toHaveLength(1)
    expect(t.interp.getState().steps.work?.error?.data).toEqual({ index: 1, message: 'item-one' })
    t.interp.send({ type: 'retry', step: 'work' })
    await turn()
    expect(t.interp.getState().output).toEqual(['ok-0', 'ok-1', 'ok-2'])
    expect([...attempts.entries()]).toEqual([
      [0, 1],
      [1, 2],
      [2, 1],
    ])
    t.interp.dispose()
  })

  it('resumes unfinished idempotent calls with their keys and keeps completed outputs', async () => {
    const seen: unknown[] = []
    const def = mapped(
      () => [0, 1],
      ({ index, idempotencyKey }) => {
        seen.push({ index, idempotencyKey })
        return index === 0 ? 'finished' : new Promise(() => {})
      },
      { idempotent: true },
    )
    const first = runner(def)
    first.interp.send({ type: 'start' })
    const saved: WizardState = JSON.parse(JSON.stringify(first.interp.getState()))
    first.interp.dispose()
    const resumed = runner(def, saved)
    resumed.interp.send({ type: 'resume', fromSeq: saved.seq })
    expect(seen).toEqual([
      { index: 0, idempotencyKey: 'map-test:work:1:0' },
      { index: 1, idempotencyKey: 'map-test:work:1:1' },
      { index: 1, idempotencyKey: 'map-test:work:1:1' },
    ])
    const each = resumed.interp.getState().steps.work?.each
    expect(each === undefined ? undefined : eachItem(each, 0).output).toBe('finished')
    resumed.interp.dispose()
    await turn()
  })

  it('retries an unstarted sibling after a mapped failure without leaving it running', () => {
    let fail = true
    const seen: unknown[] = []
    const run: Hook = ({ index }) => {
      seen.push(index)
      if (index === 0 && fail) throw new Error('first item failed')
      return index
    }
    const def = mapped(() => [0, 1, 2], run, {
      hooks: { run, mapError: () => ({ code: 'BROKEN' }) },
    })
    const t = runner(def)
    t.interp.send({ type: 'start' })
    expect(t.interp.getState().status).toBe('halted')
    expect(seen).toEqual([0, 1])
    const each = t.interp.getState().steps.work?.each
    expect(each === undefined ? undefined : eachItem(each, 2).status).toBe('failed')
    fail = false
    t.interp.send({ type: 'retry', step: 'work' })
    expect(t.interp.getState().output).toEqual([0, 1, 2])
    expect(seen).toEqual([0, 1, 0, 2])
    t.interp.dispose()
  })

  it('marks every interrupted non-idempotent item failed so manual retry can finish', () => {
    let resumed = false
    const def = mapped(
      () => [0, 1, 2],
      ({ index }) => (resumed ? index : new Promise(() => {})),
    )
    const first = runner(def)
    first.interp.send({ type: 'start' })
    const saved: WizardState = JSON.parse(JSON.stringify(first.interp.getState()))
    first.interp.dispose()
    resumed = true
    const second = runner(def, saved)
    second.interp.send({ type: 'resume', fromSeq: saved.seq })
    expect(second.interp.getState().status).toBe('halted')
    const each = second.interp.getState().steps.work?.each
    expect(each === undefined ? [] : [eachItem(each, 0).status, eachItem(each, 1).status]).toEqual([
      'failed',
      'failed',
    ])
    second.interp.send({ type: 'retry', step: 'work' })
    expect(second.interp.getState().output).toEqual([0, 1, 2])
    second.interp.dispose()
  })

  it('keeps cloneable typed values such as Dates in item snapshots', () => {
    const def = mapped(
      () => [new Date('2026-10-12T00:00:00.000Z')],
      ({ item }) => (item instanceof Date ? item.toISOString() : 'wrong type'),
    )
    const t = runner(def)
    t.interp.send({ type: 'start' })
    expect(t.interp.getState().output).toEqual(['2026-10-12T00:00:00.000Z'])
    t.interp.dispose()
  })

  it('runs ten thousand synchronous items with bounded concurrency', () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index)
    const def = mapped(
      () => items,
      ({ item }) => item,
      { each: { items: () => items, concurrency: 50 } },
    )
    const t = runner(def)
    const startedAt = performance.now()
    t.interp.send({ type: 'start' })
    const elapsed = performance.now() - startedAt
    expect(t.interp.getState().output).toEqual(items)
    expect(t.failures).toEqual([])
    expect(elapsed).toBeLessThan(1_000)
    t.interp.dispose()
  })
})
