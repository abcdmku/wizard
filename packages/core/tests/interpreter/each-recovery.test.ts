import { describe, expect, it } from 'vitest'
import type { Hook } from '../../src/authoring/compiled'
import { createRunFailure } from '../../src/authoring/run-adapter'
import { eachItem } from '../../src/machine/each-state'
import { flow, runStep } from '../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from '../wizard/e2e/harness'

describe('durable map recovery', () => {
  it('retains adapter failure classification after mapping each item error', async () => {
    const def = flow({
      start: 'work',
      steps: {
        work: {
          ...runStep({
            run: () => {
              throw createRunFailure('typed', new Error('declined'), { raw: true })
            },
            mapError: ({ index }) => ({ item: index, reason: 'declined' }),
          }),
          each: { items: () => ['a'], concurrency: 1 },
        },
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.rec('work').error).toMatchObject({
      kind: 'typed',
      data: { item: 0, reason: 'declined' },
    })
    const each = t.rec('work').each
    expect(each === undefined ? undefined : eachItem(each, 0).error).toMatchObject({
      kind: 'typed',
      data: { item: 0, reason: 'declined' },
    })
    t.run.dispose()
  })
  it('fires an overdue item retry once before reissuing interrupted work', async () => {
    let calls = 0
    const def = flow({
      start: 'work',
      steps: {
        work: {
          ...runStep({
            run: () => {
              calls++
              if (calls === 1) throw new Error('try again')
              return calls
            },
            retry: { retries: 1, backoff: 10 },
            idempotent: true,
          }),
          each: { items: () => ['a'], concurrency: 1 },
        },
      },
    })
    const first = e2e(def)
    await first.run.start()
    const saved = roundTrip(first.run.getSnapshot())
    first.run.dispose()
    const resumed = e2eResume(def, saved, { now: 10_011 })
    await tick()
    expect(calls).toBe(2)
    expect(resumed.run.getState().output).toEqual([2])
    resumed.run.dispose()
  })

  it('retains custom item idempotency keys across automatic retry and resume', async () => {
    const keys: unknown[] = []
    const mapped: unknown[] = []
    let calls = 0
    const run: Hook = ({ idempotencyKey }) => {
      keys.push(idempotencyKey)
      calls++
      if (calls === 1) throw new Error('retry this item')
      return calls
    }
    const def = flow({
      start: 'work',
      steps: {
        work: {
          ...runStep({
            run,
            retry: { retries: 1, backoff: 10 },
            idempotent: true,
            idempotencyKey: ({ index }) => {
              mapped.push(index)
              return `custom-${index}`
            },
          }),
          each: { items: () => ['a'], concurrency: 1 },
        },
      },
    })
    const first = e2e(def)
    await first.run.start()
    const saved = roundTrip(first.run.getSnapshot())
    first.run.dispose()
    const resumed = e2eResume(def, saved, { now: 10_011 })
    await tick()
    expect(mapped).toEqual([0])
    expect(keys).toEqual(['custom-0', 'custom-0'])
    expect(resumed.run.getState().output).toEqual([2])
    resumed.run.dispose()
  })

  it('retries unfinished work after resuming a halted map and keeps finished items', async () => {
    let recover = false
    let reject: (error: Error) => void = () => {}
    const seen: unknown[] = []
    const def = flow({
      start: 'work',
      steps: {
        work: {
          ...runStep({
            idempotent: true,
            run: ({ index }) => {
              seen.push(index)
              if (index === 0 || recover) return index
              if (index === 1)
                return new Promise((_, fail) => {
                  reject = fail
                })
              return new Promise(() => {})
            },
          }),
          each: { items: () => [0, 1, 2], concurrency: 3 },
        },
      },
    })
    const first = e2e(def)
    await first.run.start()
    reject(new Error('item-one failed'))
    await tick()
    expect(first.run.getState().status).toBe('halted')
    const saved = roundTrip(first.run.getSnapshot())
    first.run.dispose()
    recover = true
    const resumed = e2eResume(def, saved)
    const each = resumed.run.getState().steps.work?.each
    expect(each === undefined ? undefined : eachItem(each, 2).status).toBe('failed')
    expect(await resumed.run.retry('work')).toMatchObject({ ok: true })
    expect(resumed.run.getState().output).toEqual([0, 1, 2])
    expect(seen).toEqual([0, 1, 2, 1, 2])
    resumed.run.dispose()
  })
})
