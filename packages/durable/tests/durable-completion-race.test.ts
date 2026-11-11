import { boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { createDurableRun, createMemoryDurableStore, resumeDurableRun } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { expect, it } from 'vitest'

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let settle: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve() {
      if (settle === undefined) throw new Error('deferred promise was not initialized')
      settle()
    },
  }
}

async function tick(count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

function createRaceStore(base: DurableStore) {
  const completionStarted = deferred()
  const releaseCompletion = deferred()
  const laterBarrierStarted = deferred()
  const releaseLaterBarrier = deferred()
  let armed = false
  let completionBlocked = false
  let completionCommitted = false
  let laterBarrierBlocked = false
  return {
    arm() {
      armed = true
    },
    completionStarted: completionStarted.promise,
    releaseCompletion: () => releaseCompletion.resolve(),
    laterBarrierStarted: laterBarrierStarted.promise,
    releaseLaterBarrier: () => releaseLaterBarrier.resolve(),
    store: {
      ...base,
      async commit(input) {
        if (armed && !completionBlocked && input.completeDedupe !== undefined) {
          completionBlocked = true
          completionStarted.resolve()
          await releaseCompletion.promise
          const result = await base.commit(input)
          completionCommitted = result.ok
          return result
        }
        if (armed && completionCommitted && !laterBarrierBlocked && input.next !== undefined) {
          laterBarrierBlocked = true
          laterBarrierStarted.resolve()
          await releaseLaterBarrier.promise
        }
        return base.commit(input)
      },
    } satisfies DurableStore,
  }
}

function createFlow(taskGate: Promise<void>) {
  return defineWizard(
    {
      name: 'durable-completion-race',
      context: boundary.trusted<Record<string, never>>(),
    },
    ({ step, view, steps }) =>
      steps(
        {
          form: view({ input: boundary.trusted<Record<string, never>>(), next: 'work' }),
          work: step({
            run: async () => {
              await taskGate
              return 'worked'
            },
            idempotencyKey: true,
            next: 'done',
          }),
          done: step({ next: null }),
        },
        { start: 'form' },
      ),
  )
}

it('completes and replays a command without starving behind later local barriers', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const task = deferred()
  const flow = createFlow(task.promise)
  const raced = createRaceStore(createMemoryDurableStore({ now: scheduler.now }))
  const opened = await createDurableRun(flow, {
    context: {},
    key: 'command-completion-race',
    ownerId: 'owner-a',
    store: raced.store,
    scheduler,
    renew: 'manual',
  })
  expect(opened.ok).toBe(true)
  if (!opened.ok) throw new Error('expected a durable host')
  await opened.host.dispatch({ type: 'start' }, { commandId: 'start-1' })
  const expectedVersion = opened.host.version

  raced.arm()
  const pending = opened.host.dispatch(
    { type: 'next' },
    { commandId: 'next-1', digest: 'next-race', expectedVersion },
  )
  await raced.completionStarted
  task.resolve()
  await tick()
  raced.releaseCompletion()
  await raced.laterBarrierStarted

  const applied = await pending
  expect(applied).toMatchObject({ ok: true, status: 'applied' })
  if (!applied.ok) throw new Error('expected the command to apply')
  raced.releaseLaterBarrier()
  await tick()
  expect(opened.host.version).not.toEqual(applied.version)
  await expect(
    opened.host.dispatch(
      { type: 'next' },
      { commandId: 'next-1', digest: 'next-race', expectedVersion },
    ),
  ).resolves.toEqual({ ...applied, status: 'replayed' })
  await opened.host.dispose()

  const reopened = await resumeDurableRun(flow, {
    key: 'command-completion-race',
    ownerId: 'owner-b',
    store: raced.store,
    scheduler,
    renew: 'manual',
  })
  expect(reopened.ok).toBe(true)
  if (!reopened.ok) throw new Error('expected the host to reopen')
  await expect(
    reopened.host.dispatch(
      { type: 'next' },
      { commandId: 'next-1', digest: 'next-race', expectedVersion },
    ),
  ).resolves.toEqual({ ...applied, status: 'replayed' })
  await reopened.host.dispose()
})

it('replays a committed result after its owner crashes before publishing or returning it', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const base = createMemoryDurableStore({ now: scheduler.now })
  const completionStarted = deferred()
  let crashed = false
  const store = {
    ...base,
    async commit(input) {
      // The database committed the state and result, but the worker never sees the response.
      if (crashed && input.lease.ownerId === 'owner-a' && input.completeDedupe !== undefined) {
        const result = await base.commit(input)
        expect(result.ok).toBe(true)
        completionStarted.resolve()
        return new Promise<never>(() => undefined)
      }
      return base.commit(input)
    },
  } satisfies DurableStore
  const flow = defineWizard(
    {
      name: 'durable-command-takeover',
      context: boundary.trusted<Record<string, never>>(),
    },
    ({ step, view, steps }) =>
      steps(
        {
          a: view({
            input: boundary.trusted<Record<string, never>>(),
            next: 'b',
            exit: async () => undefined,
          }),
          b: view({ input: boundary.trusted<Record<string, never>>(), next: 'c' }),
          c: view({ input: boundary.trusted<Record<string, never>>(), next: 'done' }),
          done: step({ next: null }),
        },
        { start: 'a' },
      ),
  )
  const options = { key: 'command-takeover', store, scheduler, renew: 'manual' } as const
  const first = await createDurableRun(flow, { ...options, context: {}, ownerId: 'owner-a' })
  if (!first.ok) throw new Error('expected a durable host')
  await first.host.dispatch({ type: 'start' }, { commandId: 'start-1' })
  crashed = true
  void first.host.dispatch({ type: 'next' }, { commandId: 'next-1' })
  await completionStarted.promise
  expect(first.host.run.getState().current).toBe('a')

  scheduler.advance(base.leaseTtlMs)
  const second = await resumeDurableRun(flow, { ...options, ownerId: 'owner-b' })
  if (!second.ok) throw new Error('expected the takeover to open')
  const retried = await second.host.dispatch({ type: 'next' }, { commandId: 'next-1' })

  expect(second.host.run.getState().current).toBe('b')
  expect(retried).toMatchObject({ ok: true, status: 'replayed', result: { ok: true } })
  await expect(second.host.dispatch({ type: 'next' }, { commandId: 'next-1' })).resolves.toEqual(
    retried,
  )
  await second.host.dispose()
})

it('preserves a true external CAS conflict while completing a claim', async () => {
  const scheduler = createTestScheduler({ now: 0 })
  const base = createMemoryDurableStore({ now: scheduler.now })
  const actual = { epoch: 9, seq: 9 }
  const lost: string[] = []
  let failCompletion = true
  const store = {
    ...base,
    async commit(input) {
      if (failCompletion && input.completeDedupe !== undefined) {
        failCompletion = false
        return { ok: false, code: 'CAS_CONFLICT', actual }
      }
      return base.commit(input)
    },
  } satisfies DurableStore
  const opened = await createDurableRun(createFlow(new Promise<void>(() => undefined)), {
    context: {},
    key: 'external-completion-conflict',
    ownerId: 'owner-a',
    store,
    scheduler,
    renew: 'manual',
    onLeaseLost: (code) => lost.push(code),
  })
  expect(opened.ok).toBe(true)
  if (!opened.ok) throw new Error('expected a durable host')

  await expect(opened.host.dispatch({ type: 'start' }, { commandId: 'start-1' })).resolves.toEqual({
    ok: false,
    code: 'CAS_CONFLICT',
    message: 'the run is not at the expected version; read the current version and retry',
    actual,
  })
  expect(lost).toEqual(['CAS_CONFLICT'])
  await expect(
    opened.host.dispatch({ type: 'start' }, { commandId: 'after-loss' }),
  ).resolves.toEqual({
    ok: false,
    code: 'LEASE_LOST',
    message: 'this host no longer owns the run lease; reopen the run and retry',
  })
  await opened.host.dispose()
})
