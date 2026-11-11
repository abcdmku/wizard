import { describe, expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import {
  createInterpreter,
  type Interpreter,
  type InterpreterOptions,
} from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { MachineEnv } from '../../src/machine/types'
import { createToyMachine, flow, initialState } from '../helpers/fake-machine'

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
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

function setup(
  def: ReturnType<typeof flow>,
  options: Partial<InterpreterOptions> = {},
): { readonly interp: Interpreter; readonly scheduler: ReturnType<typeof createTestScheduler> } {
  const scheduler = createTestScheduler({ now: 1_000 })
  const ids = createSequentialIds()
  const env = { clock: scheduler, scheduler, ids }
  const machineEnv: MachineEnv = {
    def,
    path: [],
    now: scheduler.now,
    id: (prefix) => ids.id(prefix),
  }
  const interp = createInterpreter({
    def,
    machine: createToyMachine(),
    path: [],
    env,
    initialState: initialState(machineEnv, {
      instanceId: 'idle-test',
      context: { changed: false },
      now: scheduler.now(),
    }),
    ...options,
  })
  return { interp, scheduler }
}

describe('interpreter idle boundary', () => {
  it('notifies only after an async barrier and listener-enqueued follow-up batch drain', async () => {
    const gate = deferred()
    const def = flow({ steps: { form: { kind: 'view' } } })
    let firstBarrier = true
    let queued = false
    let interp: Interpreter
    ;({ interp } = setup(def, {
      beforeEffects: () => {
        if (!firstBarrier) return
        firstBarrier = false
        return gate.promise
      },
      onCommit: () => {
        if (queued) return
        queued = true
        interp.send({ type: 'context.patch', patch: { changed: true }, by: 'form' })
      },
    }))

    interp.send({ type: 'start' })
    let idleSettled = false
    const idle = interp.whenIdle().then(() => {
      idleSettled = true
    })
    expect(idleSettled).toBe(false)

    gate.resolve()
    await idle

    expect(idleSettled).toBe(true)
    expect(interp.getState().context).toEqual({ changed: true })
  })

  it('becomes idle with a future timer and a never-settling hook still live', async () => {
    const def = flow({
      start: ['work', 'waiting'],
      steps: {
        work: { kind: 'step', hooks: { run: () => new Promise<never>(() => {}) } },
        waiting: {
          kind: 'step',
          hooks: { waitFor: {} },
          waitTimeout: { afterMs: 60_000, next: 'expired' },
        },
        expired: { kind: 'step', hooks: { run: () => undefined } },
      },
    })
    const { interp, scheduler } = setup(def)

    interp.send({ type: 'start' })
    await interp.whenIdle()

    expect(interp.inflight()).toBe(1)
    expect(scheduler.pending()).toBe(1)
  })

  it.each(HOSTILE_BARRIER_MODES)(
    'aborts through onFatal when a barrier has a hostile then %s',
    async (mode) => {
      const failure = new Error(`hostile ${mode}`)
      const fatal: unknown[] = []
      const listenerErrors: unknown[] = []
      const def = flow({ steps: { form: { kind: 'view' } } })
      const { interp } = setup(def, {
        beforeEffects: () => hostileBarrier(mode, failure),
        onFatal: (error) => fatal.push(error),
        onListenerError: (error) => listenerErrors.push(error),
      })

      interp.send({ type: 'start' })
      await Promise.resolve()
      await Promise.resolve()

      expect(interp.isDisposed()).toBe(true)
      await expect(interp.whenIdle()).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
      expect(fatal).toEqual([failure])
      expect(listenerErrors).toEqual([failure])
    },
  )
})
