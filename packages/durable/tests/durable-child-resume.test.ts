import { boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { createDurableRun, createMemoryDurableStore, resumeDurableRun } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { expect, it } from 'vitest'

it('preserves completed child work when a worker crashes after the first resumed snapshot commit', async () => {
  let loads = 0
  const child = defineWizard(
    {
      name: 'durable-child-restoration',
      context: boundary.trusted<{ readonly n: number }>(),
      events: { finish: boundary.trusted<{ readonly n: number }>() },
    },
    ({ step, steps }) =>
      steps({
        load: step({
          run: ({ context }) => {
            loads += 1
            return `loaded:${context.n}`
          },
          idempotencyKey: true,
          next: 'wait',
        }),
        wait: step({ waitFor: { finish: ({ payload }) => ({ done: payload.n }) } }),
      }),
  )
  const parent = defineWizard(
    { name: 'durable-parent-restoration', context: boundary.trusted<Record<string, never>>() },
    ({ flow, steps }) => steps({ sub: flow(child, { context: () => ({ n: 7 }) }) }),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const base = createMemoryDurableStore({ now: scheduler.now })
  let resumedCommit: () => void = () => undefined
  const committed = new Promise<void>((resolve) => {
    resumedCommit = resolve
  })
  const store = {
    ...base,
    async commit(input) {
      const result = await base.commit(input)
      if (input.lease.ownerId === 'owner-b' && input.next !== undefined) {
        expect(result.ok).toBe(true)
        resumedCommit()
        return new Promise<never>(() => undefined)
      }
      return result
    },
  } satisfies DurableStore
  const options = { key: 'child-resume', store, scheduler, renew: 'manual' } as const
  const first = await createDurableRun(parent, { ...options, context: {}, ownerId: 'owner-a' })
  if (!first.ok) throw new Error(first.code)
  await first.host.dispatch({ type: 'start' }, { commandId: 'start' })
  await first.host.run.awaitOutcome()
  expect(first.host.run.child('sub').getState().steps.load.output).toBe('loaded:7')
  await first.host.dispose()

  void resumeDurableRun(parent, { ...options, ownerId: 'owner-b' })
  await committed
  scheduler.advance(store.leaseTtlMs)
  const third = await resumeDurableRun(parent, { ...options, ownerId: 'owner-c' })
  if (!third.ok) throw new Error(third.code)
  expect(third.host.run.child('sub').getState().steps.load.output).toBe('loaded:7')
  expect(loads).toBe(1)
  expect(third.host.run.waitingFor()).toMatchObject([
    { kind: 'event', path: ['sub'], step: 'wait', events: ['finish'] },
  ])

  await third.host.dispatch(
    { type: 'child', path: ['sub'], command: { type: 'send', event: 'finish', payload: { n: 8 } } },
    { commandId: 'finish' },
  )
  await expect(third.host.run.awaitResult()).resolves.toMatchObject({ status: 'done', output: 8 })
  expect(loads).toBe(1)
  await third.host.dispose()
})
