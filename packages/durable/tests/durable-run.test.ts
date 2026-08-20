import { type AnyFlow, boundary, type Command, defineFlow } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableRunHost,
  type DurableRunOpenResult,
  type DurableStore,
  resumeDurableRun,
} from '../src'

const runBuilder = defineFlow({
  name: 'durable-host-test',
  context: boundary.trusted<{ readonly n: number }>(),
  events: { ping: boundary.trusted<{ readonly n: number }>() },
})

const waitingFlow = runBuilder.steps(
  {
    wait: runBuilder.wait<'done', { readonly after: number; readonly next: 'done' }>({
      on: { ping: () => ({ keep: true }) },
      timeout: { after: 10, next: 'done' },
    }),
    done: runBuilder.final(),
  },
  { start: 'wait' },
)

const taskBuilder = defineFlow({
  name: 'durable-stale-task-test',
  context: boundary.trusted<Record<string, never>>(),
})

function makeDeferredTaskFlow(tasks: Array<() => void>, beforeTask?: () => Promise<void>) {
  return taskBuilder.steps(
    {
      work: taskBuilder.task(
        async () => {
          await beforeTask?.()
          return new Promise<void>((resolve) => {
            tasks.push(resolve)
          })
        },
        { idempotent: true, next: 'done' },
      ),
      done: taskBuilder.final(),
    },
    { start: 'work' },
  )
}

function openStore(
  schedulers: readonly TestScheduler[],
  options: Parameters<typeof createMemoryDurableStore>[0] = {},
) {
  const store = createMemoryDurableStore({
    ...options,
    now: () => Math.max(...schedulers.map((scheduler) => scheduler.now())),
  })
  return store
}

async function tick(count = 5): Promise<void> {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

async function requireHost<F extends AnyFlow>(
  result: DurableRunOpenResult<F>,
): Promise<DurableRunHost<F>> {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected a durable host')
  return result.host
}

describe('durable FlowRun host', () => {
  it('allows one owner, reports a two-owner conflict, and releases cleanly', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler], { leaseTtlMs: 20 })
    const first = await createDurableRun(waitingFlow, {
      context: { n: 0 },
      key: 'run-conflict',
      ownerId: 'owner-a',
      store,
      scheduler,
      lease: { ttlMs: 20 },
      renewEveryMs: 100,
    })
    const firstHost = await requireHost(first)
    const busy = await createDurableRun(waitingFlow, {
      context: { n: 0 },
      key: 'run-conflict',
      ownerId: 'owner-b',
      store,
      scheduler,
      lease: { ttlMs: 20 },
      renewEveryMs: 100,
    })
    expect(busy).toMatchObject({ ok: false, code: 'LEASE_BUSY' })

    expect(await firstHost.release()).toEqual({ ok: true })
    const afterRelease = await resumeDurableRun(waitingFlow, {
      key: 'run-conflict',
      ownerId: 'owner-b',
      store,
      scheduler,
      lease: { ttlMs: 20 },
      renewEveryMs: 100,
    })
    const secondHost = await requireHost(afterRelease)
    expect(secondHost.lease.ownerId).toBe('owner-b')
    await secondHost.dispose()
  })

  it('CAS-persists versions before effects, replays duplicate ids, and checks expectedVersion', async () => {
    const scheduler = createTestScheduler({ now: 0 })
    const store = openStore([scheduler])
    const host = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-dedupe',
        ownerId: 'owner-a',
        store,
        scheduler,
        renewEveryMs: 100,
      }),
    )
    const initial = host.version
    const command = { type: 'start' } satisfies Command<typeof waitingFlow>
    const applied = await host.dispatch(command, {
      commandId: 'command-1',
      expectedVersion: initial,
    })
    expect(applied).toMatchObject({ ok: true, status: 'applied' })
    const afterCommand = host.version
    expect(afterCommand.seq).toBeGreaterThan(initial.seq)
    expect((await store.read('run-dedupe'))?.version).toEqual(afterCommand)

    const replay = await host.dispatch(command, { commandId: 'command-1' })
    expect(replay).toMatchObject({ ok: true, status: 'replayed' })
    expect(host.version).toEqual(afterCommand)
    expect(await host.dispatch({ type: 'cancel' }, { commandId: 'command-1' })).toEqual({
      ok: false,
      code: 'DEDUPLICATE_CONFLICT',
    })

    const stale = await host.send(
      'ping',
      { n: 1 },
      {
        eventId: 'event-1',
        expectedVersion: initial,
      },
    )
    expect(stale).toMatchObject({ ok: false, code: 'CAS_CONFLICT', actual: afterCommand })

    const event = await host.send('ping', { n: 1 }, { eventId: 'event-1' })
    expect(event).toMatchObject({ ok: true, status: 'applied' })
    const eventReplay = await host.send('ping', { n: 1 }, { eventId: 'event-1' })
    expect(eventReplay).toMatchObject({ ok: true, status: 'replayed' })
    expect(await host.send('ping', { n: 2 }, { eventId: 'event-1' })).toEqual({
      ok: false,
      code: 'DEDUPLICATE_CONFLICT',
    })
    await host.dispose()
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
        lease: { ttlMs: 10 },
        renewEveryMs: 100,
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
        lease: { ttlMs: 10 },
        renewEveryMs: 100,
      }),
    )
    expect(second.lease.ownerId).toBe('owner-b')
    expect(pending).toHaveLength(2) // resume re-issues the idempotent task

    pending[0]?.()
    await tick(8)
    expect(lost).toContain('LEASE_LOST')
    expect(await first.dispatch({ type: 'cancel' }, { commandId: 'late-command' })).toEqual({
      ok: false,
      code: 'LEASE_LOST',
    })
    await second.dispose()
  })

  it('claims a timer after failover and atomically completes its timer marker', async () => {
    const firstScheduler = createTestScheduler({ now: 0 })
    const secondScheduler = createTestScheduler({ now: 0 })
    const store = openStore([firstScheduler, secondScheduler], {
      leaseTtlMs: 5,
      timerClaimTtlMs: 5,
    })
    const first = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-timer-failover',
        ownerId: 'owner-a',
        store,
        scheduler: firstScheduler,
        lease: { ttlMs: 5 },
        renewEveryMs: 100,
      }),
    )
    await first.dispatch({ type: 'start' }, { commandId: 'start-1' })
    await tick()
    expect(first.run.getState().timers['wait:wait']).toBeDefined()

    secondScheduler.advance(6)
    const second = await requireHost(
      await createDurableRun(waitingFlow, {
        context: { n: 0 },
        key: 'run-timer-failover',
        ownerId: 'owner-b',
        store,
        scheduler: secondScheduler,
        lease: { ttlMs: 5 },
        renewEveryMs: 100,
      }),
    )
    secondScheduler.advance(4)
    await tick(10)
    expect(second.run.getState().status).toBe('done')
    expect(second.run.getState().timers).toEqual({})
    expect(second.run.log().some((event) => event.type === 'timer.fired')).toBe(true)
    expect((await store.read('run-timer-failover'))?.version).toEqual(second.version)
    await first.dispose()
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
        renewEveryMs: 100,
      }),
    )
    const events: unknown[] = []
    const states: unknown[] = []
    host.run.observe((event) => events.push(event))
    host.run.subscribe((state) => states.push(state))
    const result = await host.dispatch({ type: 'start' }, { commandId: 'start-1' })
    expect(result).toMatchObject({ ok: false, code: 'LEASE_LOST' })
    expect(events).toEqual([])
    expect(states).toEqual([])
    expect(host.run.log()).toEqual([])
    await host.dispose()
  })

  it('aborts the run immediately when renewal observes a lost fence', async () => {
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
        lease: { ttlMs: 10 },
        renewEveryMs: 100,
        onLeaseLost: (code) => lost.push(code),
      }),
    )
    scheduler.advance(11)
    const takeover = await store.acquire('run-renew-loss', 'owner-b', { ttlMs: 10 })
    expect(takeover.ok).toBe(true)
    expect(await host.renew()).toEqual({ ok: false, code: 'LEASE_LOST' })
    expect(lost).toEqual(['LEASE_LOST'])
    expect(await host.dispatch({ type: 'start' }, { commandId: 'late' })).toEqual({
      ok: false,
      code: 'LEASE_LOST',
    })
    if (takeover.ok) await store.release(takeover.lease)
    await host.dispose()
  })
})
