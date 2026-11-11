/**
 * The commit boundary across a run tree: a child hook waits for the messages its ancestors queued
 * before it, the snapshot pairs the committed parent with the children committed with it, and an
 * aborted runtime takes its children down with it (or fails its parent's flow step).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flow, flowStep, runStep, view } from '../../helpers/fixtures'
import { e2e, e2eResume } from './harness'

const shipping = (ship: Parameters<typeof runStep>[0]) =>
  flow({ name: 'fulfil', start: 'ship', steps: { ship: runStep(ship) } })

const checkout = (child: ReturnType<typeof flow>) =>
  flow({ name: 'checkout', start: 'fulfil', steps: { fulfil: flowStep(child) } })

/** Pick then ship: a child that waits on views, so the test decides when it moves. */
const picking = flow({
  name: 'fulfil',
  start: 'pick',
  steps: { pick: view({ next: 'ship' }), ship: view() },
})

/** When set, the machine's `decide` throws `error` for a `type` message in the run at `depth`. */
const fault = vi.hoisted(() => ({
  at: undefined as { depth: number; type: string; error: Error } | undefined,
}))

vi.mock('../../../src/machine/decide', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/machine/decide')>()
  const decide: typeof real.decide = (env, state, msg) => {
    const at = fault.at
    if (at !== undefined && env.path.length === at.depth && msg.type === at.type) throw at.error
    return real.decide(env, state, msg)
  }
  return { ...real, decide }
})

const throwingAt = (depth: number, type: string, error: Error): void => {
  fault.at = { depth, type, error }
}

afterEach(() => {
  fault.at = undefined
})

describe('commit boundary across nested flows', () => {
  it.each([
    'an observer cancels on the child step.runStarted',
    'an observer cancels on the parent child.started',
    'the user cancels while the child.started barrier is pending',
  ] as const)(
    'never starts a child hook once a parent cancel is queued ahead of it: %s',
    async (trigger) => {
      const log: string[] = []
      let release = (): void => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const pending = trigger === 'the user cancels while the child.started barrier is pending'
      const t = e2e(checkout(shipping({ run: () => log.push('ship') })), {
        ...(pending
          ? {
              beforeEffects: ({ events }) =>
                events.some((event) => event.type === 'child.started') ? gate : undefined,
            }
          : {}),
      })
      t.run.observe((event) => {
        const fromChild = event.path.length === 1
        if (
          (trigger === 'an observer cancels on the child step.runStarted' &&
            fromChild &&
            event.type === 'step.runStarted') ||
          (trigger === 'an observer cancels on the parent child.started' &&
            event.type === 'child.started')
        ) {
          void t.run.cancel()
        }
      })

      const started = t.run.start()
      if (pending) {
        const cancelled = t.run.cancel()
        release()
        await cancelled
      }
      await started

      expect(log).toEqual([])
      expect(t.run.getState().status).toBe('cancelled')
    },
  )

  it('pairs the committed parent with the children committed with it, also after an abort', async () => {
    const failure = new Error('CAS failed')
    let reject = (): void => {}
    const gate = new Promise<void>((_, rejectGate) => {
      reject = () => rejectGate(failure)
    })
    let gated = false
    const t = e2e(checkout(picking), {
      beforeEffects: () => (gated ? gate : undefined),
      onListenerError: () => {},
    })
    await t.run.start()
    gated = true
    const moved = t.run.child('fulfil').next()
    const pair = () => {
      const snapshot = t.run.getSnapshot()
      return [snapshot.state.steps.fulfil?.child?.current, snapshot.children.fulfil?.state.current]
    }

    expect(pair()).toEqual(['pick', 'pick'])
    reject()
    await moved
    await Promise.resolve()

    expect(t.run.isDisposed()).toBe(true)
    expect(pair()).toEqual(['pick', 'pick'])
  })

  it('restores no child when the root resume batch throws', async () => {
    const log: string[] = []
    const child = shipping({
      idempotent: true,
      run: () => {
        log.push('ship')
        return new Promise(() => {})
      },
    })
    const first = e2e(checkout(child))
    await first.run.start()
    const snapshot = first.run.getSnapshot()
    first.run.dispose()

    throwingAt(0, 'resume', new Error('clock unavailable'))
    const resumed = e2eResume(checkout(child), snapshot, { onListenerError: () => {} })

    expect(resumed.run.isDisposed()).toBe(true)
    expect(log).toEqual(['ship'])
  })

  it('still answers child() with the disposed child after a failed barrier', async () => {
    let failing = false
    const t = e2e(checkout(picking), {
      beforeEffects: () => {
        if (failing) throw new Error('CAS failed')
      },
      onListenerError: () => {},
    })
    await t.run.start()
    failing = true

    await t.run.cancel()

    expect(t.run.child('fulfil').isDisposed()).toBe(true)
  })

  it.each(['cancel', 'resume'] as const)(
    'fails the flow step when its child aborts while processing %s',
    async (type) => {
      const failure = new Error('decide exploded')
      const options = { onListenerError: () => {} }
      let t = e2e(checkout(picking), type === 'cancel' ? options : {})
      await t.run.start()
      throwingAt(1, type, failure)

      if (type === 'cancel') {
        await expect(t.run.child('fulfil').cancel()).resolves.toMatchObject({ code: 'DISPOSED' })
      } else {
        t = e2eResume(checkout(picking), t.run.getSnapshot(), options)
      }

      expect(t.rec('fulfil')).toMatchObject({
        status: 'failed',
        error: { message: 'decide exploded' },
      })
    },
  )
})
