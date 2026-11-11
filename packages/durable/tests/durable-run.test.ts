import { type AnyWizard, boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableRunHost,
  type DurableRunOpenResult,
  resumeDurableRun,
} from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { describe, expect, it } from 'vitest'

const leaseLost = {
  ok: false,
  code: 'LEASE_LOST',
  message: 'this host no longer owns the run lease; reopen the run and retry',
}

const waitingFlow = defineWizard(
  {
    name: 'durable-host-test',
    context: boundary.trusted<{ readonly n: number; readonly card?: string }>(),
    events: { ping: boundary.trusted<{ readonly n: number }>() },
  },
  ({ step, steps }) =>
    steps(
      {
        wait: step({
          waitFor: { ping: () => ({ keep: true }) },
          timeout: { after: 10, next: 'done' },
        }),
        done: step({ next: null }),
      },
      { start: 'wait' },
    ),
)

function makeDeferredTaskFlow(tasks: Array<() => void>, beforeTask?: () => Promise<void>) {
  return defineWizard(
    {
      name: 'durable-stale-task-test',
      context: boundary.trusted<Record<string, never>>(),
    },
    ({ step, steps }) =>
      steps(
        {
          work: step({
            run: async () => {
              await beforeTask?.()
              return new Promise<void>((resolve) => {
                tasks.push(resolve)
              })
            },
            idempotencyKey: true,
            next: 'done',
          }),
          done: step({ next: null }),
        },
        { start: 'work' },
      ),
  )
}

function openStore(
  schedulers: readonly TestScheduler[],
  options: Parameters<typeof createMemoryDurableStore>[0] = {},
) {
  return createMemoryDurableStore({
    ...options,
    now: () => Math.max(...schedulers.map((scheduler) => scheduler.now())),
  })
}

async function tick(count = 5): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

async function requireHost<F extends AnyWizard>(
  result: DurableRunOpenResult<F>,
): Promise<DurableRunHost<F>> {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected a durable host')
  return result.host
}

describe('durable Run host', () => {
  it('allows one owner, reports a two-owner conflict, and releases cleanly', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler], { leaseTtlMs: 20 })
    const options = { key: 'run-conflict', store, scheduler, renew: 'manual' } as const
    const firstHost = await requireHost(
      await createDurableRun(waitingFlow, { ...options, context: { n: 0 }, ownerId: 'owner-a' }),
    )
    expect(
      await createDurableRun(waitingFlow, { ...options, context: { n: 0 }, ownerId: 'owner-b' }),
    ).toEqual({ ok: false, code: 'LEASE_BUSY', retryAt: 20 })

    expect(await firstHost.release()).toEqual({ ok: true })
    const secondHost = await requireHost(
      await resumeDurableRun(waitingFlow, { ...options, ownerId: 'owner-b' }),
    )
    expect(secondHost.lease.ownerId).toBe('owner-b')
    await secondHost.dispose()
  })

  it('commits each version to the store before the command result returns', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler])
    const host = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-commit',
        ownerId: 'owner-a',
        store,
        scheduler,
        renew: 'manual',
      }),
    )
    expect(await store.read('run-commit')).toEqual({
      value: host.run.getSnapshot(),
      version: host.version,
    })
    const applied = await host.dispatch({ type: 'start' }, { commandId: 'start-1' })
    expect(applied).toMatchObject({ ok: true, status: 'applied', version: host.version })
    expect(await store.read('run-commit')).toEqual({
      value: host.run.getSnapshot(),
      version: host.version,
    })
    await host.dispose()
  })

  it('commits only the redacted snapshot to the store', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler])
    const host = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0, card: '4242 4242 4242 4242' },
        key: 'run-redact',
        ownerId: 'owner-a',
        store,
        scheduler,
        renew: 'manual',
        redact: (snapshot) => ({
          ...snapshot,
          state: { ...snapshot.state, context: { n: snapshot.state.context.n } },
        }),
      }),
    )
    await host.dispatch({ type: 'start' }, { commandId: 'start-1' })
    const stored = await store.read('run-redact')
    expect(stored?.value).toMatchObject({ state: { context: { n: 0 } } })
    expect(JSON.stringify(stored?.value)).not.toContain('4242')
    expect(host.run.getState().context.card).toBe('4242 4242 4242 4242')
    await host.dispose()
  })

  it('renews on the scheduler by default and only on request with renew: manual', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler], { leaseTtlMs: 30 })
    const open = (key: string, renew?: 'manual') =>
      createDurableRun(waitingFlow, {
        context: { n: 0 },
        key,
        ownerId: 'owner-a',
        store,
        scheduler,
        ...(renew === undefined ? {} : { renew }),
      })
    const automatic = await requireHost(await open('run-auto'))
    const manual = await requireHost(await open('run-manual', 'manual'))
    expect([automatic.lease.expiresAt, manual.lease.expiresAt]).toEqual([30, 30])

    scheduler.advance(10)
    await tick()
    expect(automatic.lease.expiresAt).toBe(40)
    expect(manual.lease.expiresAt).toBe(30)
    expect(await manual.renew()).toMatchObject({ ok: true, lease: { expiresAt: 40 } })

    scheduler.advance(31)
    await tick()
    expect(await store.acquire('run-auto', 'owner-b')).toMatchObject({ code: 'LEASE_BUSY' })
    expect(await store.acquire('run-manual', 'owner-b')).toMatchObject({ ok: true })
    await automatic.dispose()
    await manual.dispose()
  })

  it('rejects a renewal interval that would let the lease lapse', async () => {
    const store = createMemoryDurableStore({ leaseTtlMs: 30 })
    await expect(
      createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-slow-renewal',
        ownerId: 'owner-a',
        store,
        renew: { everyMs: 30 },
      }),
    ).rejects.toMatchObject({ name: 'DurableStoreError', code: 'INVALID_ARGUMENT' })
    expect(await store.acquire('run-slow-renewal', 'owner-b')).toMatchObject({ ok: true })
  })

  it('fences a stale task completion after a replacement owner resumes', async () => {
    const firstScheduler = createTestScheduler({ now: 0 })
    const secondScheduler = createTestScheduler({ now: 0 })
    const store = openStore([firstScheduler, secondScheduler], { leaseTtlMs: 10 })
    const pending: Array<() => void> = []
    let persistedBeforeTask: { readonly epoch: number; readonly seq: number } | undefined
    const flow = makeDeferredTaskFlow(pending, async () => {
      persistedBeforeTask = (await store.read('run-stale-task'))?.version
    })
    const lost: string[] = []
    const first = await requireHost(
      await createDurableRun(flow, {
        context: {},
        key: 'run-stale-task',
        ownerId: 'owner-a',
        store,
        scheduler: firstScheduler,
        renew: 'manual',
        onLeaseLost: (code) => lost.push(code),
      }),
    )
    await first.dispatch({ type: 'start' }, { commandId: 'start-1' })
    await tick()
    expect(pending).toHaveLength(1)
    expect(persistedBeforeTask).toEqual(first.version)

    secondScheduler.advance(11)
    const second = await requireHost(
      await createDurableRun(flow, {
        context: {},
        key: 'run-stale-task',
        ownerId: 'owner-b',
        store,
        scheduler: secondScheduler,
        renew: 'manual',
      }),
    )
    expect(second.lease.ownerId).toBe('owner-b')
    expect(pending).toHaveLength(2) // resume re-issues the idempotent task

    pending[0]?.()
    await tick(8)
    expect(lost).toEqual(['LEASE_LOST'])
    expect(await first.dispatch({ type: 'cancel' }, { commandId: 'late-command' })).toEqual(
      leaseLost,
    )
    await second.dispose()
  })

  it('claims a timer after failover and atomically completes its timer marker', async () => {
    const firstScheduler = createTestScheduler({ now: 0 })
    const secondScheduler = createTestScheduler({ now: 0 })
    const store = openStore([firstScheduler, secondScheduler], {
      leaseTtlMs: 5,
      timerClaimTtlMs: 5,
      retention: { completedDedupeMs: 0, timerClaimMs: 0 },
    })
    const options = {
      context: { n: 0 },
      key: 'run-timer-failover',
      store,
      renew: 'manual' as const,
    }
    const first = await requireHost(
      await createDurableRun(waitingFlow, {
        ...options,
        ownerId: 'owner-a',
        scheduler: firstScheduler,
      }),
    )
    await first.dispatch({ type: 'start' }, { commandId: 'start-1' })
    await tick()
    expect(first.run.getState().timers['wait:wait']).toBeDefined()

    secondScheduler.advance(6)
    const second = await requireHost(
      await createDurableRun(waitingFlow, {
        ...options,
        ownerId: 'owner-b',
        scheduler: secondScheduler,
      }),
    )
    secondScheduler.advance(4)
    await second.run.awaitResult()
    expect(second.run.getState().status).toBe('done')
    expect(second.run.getState().timers).toEqual({})
    expect(second.run.log().some((event) => event.type === 'timer.fired')).toBe(true)
    expect((await store.read('run-timer-failover'))?.version).toEqual(second.version)
    // The fired timer's claim was completed with the snapshot that consumed it, so only the
    // completed start command is left for retention to sweep.
    secondScheduler.advance(10)
    expect(await store.sweep()).toEqual({ dedupeRemoved: 1, timerClaimsRemoved: 0 })
    await first.dispose()
    await second.dispose()
  })

  it('fires a wait timeout that fell due while no worker held the run before a late event', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler], { leaseTtlMs: 5 })
    const options = { key: 'run-overdue', store, scheduler, renew: 'manual' as const }
    const first = await requireHost(
      await createDurableRun(waitingFlow, { ...options, context: { n: 0 }, ownerId: 'owner-a' }),
    )
    await first.dispatch({ type: 'start' }, { commandId: 'start-1' })
    await first.dispose()

    scheduler.advance(30)
    const second = await requireHost(
      await resumeDurableRun(waitingFlow, { ...options, ownerId: 'owner-b' }),
    )
    expect(await second.send('ping', { n: 1 }, { eventId: 'late-ping' })).toMatchObject({
      ok: false,
      code: 'FLOW_TERMINAL',
    })
    expect(second.run.getState().steps.done.status).toBe('done')
    expect((await store.read('run-overdue'))?.version).toEqual(second.version)
    await second.dispose()
  })

  it('stops before publication when the durable snapshot CAS conflicts', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const base = openStore([scheduler])
    let commitCount = 0
    const store: DurableStore = {
      ...base,
      async commit(input) {
        commitCount += 1
        if (commitCount === 2) {
          return { ok: false, code: 'CAS_CONFLICT', actual: input.expected }
        }
        return base.commit(input)
      },
    }
    const host = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-cas-conflict',
        ownerId: 'owner-a',
        store,
        scheduler,
        renew: 'manual',
      }),
    )
    const events: unknown[] = []
    const states: unknown[] = []
    host.run.observe((event) => events.push(event))
    host.run.subscribe((state) => states.push(state))
    expect(await host.dispatch({ type: 'start' }, { commandId: 'start-1' })).toEqual({
      ok: false,
      code: 'CAS_CONFLICT',
      message: 'the run is not at the expected version; read the current version and retry',
      actual: { epoch: 0, seq: 0 },
    })
    expect(events).toEqual([])
    expect(states).toEqual([])
    expect(host.run.log()).toEqual([])
    await host.dispose()
  })

  it('stops the run when a renewal finds the lease taken over', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler], { leaseTtlMs: 10 })
    const lost: string[] = []
    const host = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-renew-loss',
        ownerId: 'owner-a',
        store,
        scheduler,
        renew: 'manual',
        onLeaseLost: (code) => lost.push(code),
      }),
    )
    scheduler.advance(11)
    const takeover = await store.acquire('run-renew-loss', 'owner-b')
    expect(takeover.ok).toBe(true)
    expect(await host.renew()).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(lost).toEqual(['LEASE_LOST'])
    expect(await host.dispatch({ type: 'start' }, { commandId: 'late' })).toEqual(leaseLost)
    await host.dispose()
  })
})
