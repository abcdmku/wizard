import { type AnyWizard, boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableRunHost,
  type DurableRunOpenResult,
  type MemoryDurableStore,
  resumeDurableRun,
} from '@openwizard/durable'
import { expect, it } from 'vitest'

const flow = defineWizard(
  {
    name: 'durable-replay-test',
    context: boundary.trusted<Record<string, never>>(),
    events: { ping: boundary.trusted<{ readonly n: number }>() },
  },
  ({ step, steps }) =>
    steps({ waiting: step({ waitFor: { ping: () => ({ keep: true }) } }) }, { start: 'waiting' }),
)

async function requireHost<F extends AnyWizard>(
  result: DurableRunOpenResult<F>,
): Promise<DurableRunHost<F>> {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected a durable host')
  return result.host
}

async function createHost(
  key: string,
  store: MemoryDurableStore,
  scheduler: TestScheduler,
): Promise<DurableRunHost<typeof flow>> {
  return requireHost(
    await createDurableRun(flow, {
      context: {},
      key,
      ownerId: 'owner-a',
      store,
      scheduler,
      renew: 'manual',
    }),
  )
}

async function reopen(key: string, store: MemoryDurableStore, scheduler: TestScheduler) {
  return requireHost(
    await resumeDurableRun(flow, { key, ownerId: 'owner-b', store, scheduler, renew: 'manual' }),
  )
}

it('orders command replay and digest conflicts before expected-version rejection', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const host = await createHost('command-replay', store, scheduler)
  const expectedVersion = host.version
  const command = { type: 'start' } as const
  const applied = await host.dispatch(command, { commandId: 'command-1', expectedVersion })
  expect(applied.ok).toBe(true)
  if (!applied.ok) throw new Error('expected the command to apply')
  const eventsAfterApply = host.run.log()

  await expect(
    host.dispatch(command, { commandId: 'command-1', expectedVersion }),
  ).resolves.toEqual({ ...applied, status: 'replayed' })
  await expect(
    host.dispatch({ type: 'cancel' }, { commandId: 'command-1', expectedVersion }),
  ).resolves.toEqual({
    ok: false,
    code: 'DEDUPLICATE_CONFLICT',
    message: 'this command id was already used for a different command',
  })
  await expect(
    host.dispatch({ type: 'cancel' }, { commandId: 'command-2', expectedVersion }),
  ).resolves.toEqual({
    ok: false,
    code: 'CAS_CONFLICT',
    message: 'the run is not at the expected version; read the current version and retry',
    actual: applied.version,
  })
  expect(host.run.log()).toEqual(eventsAfterApply)

  await expect(
    host.dispatch({ type: 'cancel' }, { commandId: 'command-2', expectedVersion: host.version }),
  ).resolves.toMatchObject({ ok: true, status: 'applied' })
  await host.dispose()
})

it('replays a completed command after reopening the host', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const first = await createHost('restart-replay', store, scheduler)
  const expectedVersion = first.version
  const command = { type: 'start' } as const
  const applied = await first.dispatch(command, { commandId: 'command-1', expectedVersion })
  expect(applied.ok).toBe(true)
  await first.dispose()

  const reopened = await reopen('restart-replay', store, scheduler)
  await expect(
    reopened.dispatch(command, { commandId: 'command-1', expectedVersion }),
  ).resolves.toEqual({ ...applied, status: 'replayed' })
  await reopened.dispose()
})

it('answers a redelivered eventId as a duplicate without delivering it again', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const host = await createHost('event-duplicate', store, scheduler)
  await host.dispatch({ type: 'start' }, { commandId: 'start-1' })
  expect(await host.send('ping', { n: 1 }, { eventId: 'event-1' })).toMatchObject({
    ok: true,
    delivered: ['waiting'],
  })
  const committed = await store.read('event-duplicate')
  const log = host.run.log()

  expect(await host.send('ping', { n: 1 }, { eventId: 'event-1' })).toMatchObject({
    ok: true,
    duplicate: true,
    delivered: [],
    version: committed?.version,
  })
  expect(host.run.log()).toEqual(log)
  expect(await store.read('event-duplicate')).toEqual(committed)
  await host.dispose()
})

it('keeps answering duplicate after the lease moves to another owner', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const first = await createHost('event-takeover', store, scheduler)
  await first.dispatch({ type: 'start' }, { commandId: 'start-1' })
  await first.send('ping', { n: 1 }, { eventId: 'event-1' })
  await first.dispose()

  const reopened = await reopen('event-takeover', store, scheduler)
  expect(await reopened.send('ping', { n: 1 }, { eventId: 'event-1' })).toMatchObject({
    ok: true,
    duplicate: true,
    delivered: [],
  })
  expect(await reopened.send('ping', { n: 2 }, { eventId: 'event-2' })).toMatchObject({
    ok: true,
    delivered: ['waiting'],
  })
  await reopened.dispose()
})

it('does not let a redelivered approval satisfy the next approval step', async () => {
  const approvalFlow = defineWizard(
    {
      name: 'two-level-approval',
      context: boundary.trusted<{ readonly approvals: readonly string[] }>(),
      events: { approve: boundary.trusted<{ readonly by: string }>() },
    },
    ({ step, steps }) =>
      steps({
        manager: step({
          waitFor: {
            approve: ({ payload, context, update }) =>
              update({ approvals: [...context.approvals, `manager:${payload.by}`] }),
          },
          next: 'director',
        }),
        director: step({
          waitFor: {
            approve: ({ payload, context, update }) =>
              update({ approvals: [...context.approvals, `director:${payload.by}`] }),
          },
          next: 'done',
        }),
        done: step({ next: null }),
      }),
  )
  const host = await requireHost(
    await createDurableRun(approvalFlow, {
      context: { approvals: [] },
      store: createMemoryDurableStore(),
      key: 'purchase-order',
      ownerId: 'worker-1',
      renew: 'manual',
    }),
  )
  await host.dispatch({ type: 'start' }, { commandId: 'start' })
  await host.send('approve', { by: 'mia' }, { eventId: 'approval-1' })
  await host.send('approve', { by: 'mia' }, { eventId: 'approval-1' })
  expect(host.run.getState().context.approvals).toEqual(['manager:mia'])
  await host.dispose()
})
