import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compile } from '../../src/authoring/compile'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { initialState, machine } from '../../src/machine'
import { createRun, type RunEvent, RunLifecycleError } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'
import { createWizardRuntime } from '../../src/wizard/runtime'

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
} {
  let release = (): void => {}
  let fail = (_error: unknown): void => {}
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, resolve: release, reject: fail }
}

const HOSTILE_BARRIER_MODES: readonly ('getter' | 'call')[] = ['getter', 'call']

function hostileBarrier(mode: 'getter' | 'call', failure: Error): Promise<void> {
  return new Proxy(Promise.resolve(), {
    get(target, property, receiver) {
      if (property !== 'then') return Reflect.get(target, property, receiver)
      if (mode === 'getter') throw failure
      return () => {
        throw failure
      }
    },
  })
}

const eventFlow = defineWizard(
  {
    name: 'when-idle-event',
    context: z.object({ ticks: z.number() }),
    events: { tick: z.object({}) },
  },
  ({ view, steps }) =>
    steps(
      {
        lobby: view({
          on: {
            tick: ({ context, update }) => {
              update({ ticks: context.ticks + 1 })
              return { next: 'battle' }
            },
          },
          next: 'battle',
        }),
        battle: view({
          next: null,
        }),
      },
      { start: 'lobby' },
    ),
)

describe('Run.whenIdle', () => {
  it('waits for the current host barrier and every synchronous follow-up batch', async () => {
    const gate = deferred()
    let gateSeen = false
    const run = createRun(eventFlow, {
      context: { ticks: 0 },
      beforeEffects: ({ events }) => {
        if (!gateSeen && events.some((event) => event.type === 'event.received')) {
          gateSeen = true
          return gate.promise
        }
      },
    })
    const events: RunEvent<typeof eventFlow>[] = []
    const commits: number[] = []
    let listenerIdle: Promise<void> | undefined
    run.observe((event) => events.push(event))
    run.subscribe((state) => {
      commits.push(state.seq)
      if (gateSeen && listenerIdle === undefined) listenerIdle = run.whenIdle()
    })

    await run.start()
    const sending = run.send('tick', {})
    const barrierIdle = run.whenIdle()
    expect(gateSeen).toBe(true)
    expect(run.getState().context.ticks).toBe(0)

    gate.resolve()
    await sending
    await barrierIdle
    if (listenerIdle === undefined) throw new Error('the commit listener did not run')
    await listenerIdle

    expect(run.getState().context.ticks).toBe(1)
    expect(run.getState().current).toBe('battle')
    expect(events.map((event) => event.type)).toContain('context.changed')
    const settledSeq = run.getState().seq
    const settledCommits = commits.slice()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(run.getState().seq).toBe(settledSeq)
    expect(commits).toEqual(settledCommits)
  })

  it('resolves while future timers and indefinitely-running task hooks remain pending', async () => {
    const scheduler = createTestScheduler({ now: 1_000 })
    const flow = defineWizard(
      {
        name: 'when-idle-pending-work',
        context: z.object({}),
        events: { release: z.object({}) },
      },
      ({ step, steps }) =>
        steps(
          {
            work: step({ run: () => new Promise<never>(() => {}) }),
            waiting: step({
              waitFor: { release: () => ({ keep: true }) },
              timeout: { after: '60s', next: 'expired' },
            }),
            expired: step({ next: null }),
          },
          { start: ['work', 'waiting'] },
        ),
    )
    const run = createRun(flow, { context: {}, scheduler })

    await run.start()
    await run.whenIdle()

    expect(run.getState().steps.work.status).toBe('active')
    expect(run.getState().steps.waiting.status).toBe('active')
    expect(scheduler.pending()).toBe(1)
    run.dispose()
  })

  it('resolves at once when idle and rejects waiters consistently when disposed', async () => {
    const gate = deferred()
    const run = createRun(eventFlow, {
      context: { ticks: 0 },
      beforeEffects: ({ events }) =>
        events.some((event) => event.type === 'event.received') ? gate.promise : undefined,
    })
    await run.start()
    await expect(run.whenIdle()).resolves.toBeUndefined()

    const sending = run.send('tick', {})
    const waiting = run.whenIdle()
    run.dispose()

    await expect(waiting).rejects.toEqual(new RunLifecycleError('RUN_DISPOSED'))
    await expect(run.whenIdle()).rejects.toEqual(new RunLifecycleError('RUN_DISPOSED'))
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'DISPOSED' })
    gate.resolve()
  })

  it('rejects current and future waiters when a host barrier aborts the runtime', async () => {
    const gate = deferred()
    const errors: unknown[] = []
    const run = createWizardRuntime(compile(eventFlow), {
      context: { ticks: 0 },
      machine,
      initialState,
      beforeEffects: ({ events }) =>
        events.some((event) => event.type === 'event.received') ? gate.promise : undefined,
      onListenerError: (error) => errors.push(error),
    })
    await run.start()
    const sending = run.send('tick', {})
    const waiting = run.whenIdle()

    const failure = new Error('CAS failed')
    gate.reject(failure)

    await expect(waiting).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
    await expect(run.whenIdle()).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'DISPOSED' })
    expect(errors).toEqual([failure])
  }, 500)

  it.each(HOSTILE_BARRIER_MODES)(
    'rejects idle waiters when a barrier has a hostile then %s',
    async (mode) => {
      const failure = new Error(`hostile ${mode}`)
      const errors: unknown[] = []
      let waiting: Promise<void> | undefined
      let run: ReturnType<typeof createWizardRuntime>
      run = createWizardRuntime(compile(eventFlow), {
        context: { ticks: 0 },
        machine,
        initialState,
        beforeEffects: () => {
          waiting = run.whenIdle()
          return hostileBarrier(mode, failure)
        },
        onListenerError: (error) => errors.push(error),
      })

      await expect(run.start()).resolves.toMatchObject({ ok: false, code: 'DISPOSED' })
      if (waiting === undefined) throw new Error('beforeEffects did not register an idle waiter')
      await expect(waiting).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
      await expect(run.whenIdle()).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
      expect(run.isDisposed()).toBe(true)
      expect(errors).toEqual([failure])
    },
  )
})
