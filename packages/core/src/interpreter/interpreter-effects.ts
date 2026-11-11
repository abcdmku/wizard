/**
 * Dispatch of every planned effect except hook calls (the interpreter queues those, see
 * `interpreter.ts`): timers, child runtimes, persistence reasons and transaction settles.
 * @internal
 */

import type { Message } from '../machine/commands'
import type { CallEffect, Effect } from '../machine/effects'
import type { DomainEvent } from '../machine/events'
import type { WizardState } from '../machine/state'
import type { ChildBridge, ChildHandle } from './child'
import { causeOf } from './envelope'
import type { InterpreterOptions } from './interpreter-types'
import type { TimerRegistry } from './timers'

export type PersistReason = 'change' | 'final' | 'manual'

export interface EffectDispatcherOptions<H extends ChildHandle, P> {
  readonly timers: TimerRegistry
  readonly bridge: ChildBridge<H, P> | undefined
  readonly beforeTimer: InterpreterOptions<H, P>['beforeTimer']
  getState(): WizardState
  send(msg: Message, causedBy?: number): void
  /** A transaction `settle` effect (the runtime resolves the command's promise). */
  settle(effect: Extract<Effect, { kind: 'settle' }>): void
  persist(reason: PersistReason): void
}

export function createEffectDispatcher<H extends ChildHandle, P>(
  opts: EffectDispatcherOptions<H, P>,
): (effect: Exclude<Effect, CallEffect>, batch: readonly DomainEvent[]) => void {
  const { timers, bridge, beforeTimer } = opts
  return (effect, batch) => {
    const cause = causeOf(effect, batch)
    switch (effect.kind) {
      case 'timer.set':
        timers.set(
          effect.timerId,
          effect.at,
          () => opts.send(effect.fire, cause),
          beforeTimer === undefined
            ? undefined
            : () => {
                const state = opts.getState()
                return beforeTimer(effect.timerId, effect.at, {
                  epoch: state.epoch,
                  seq: state.seq,
                })
              },
        )
        return
      case 'timer.clear':
        timers.clear(effect.timerId)
        return
      case 'child.create': {
        if (bridge !== undefined) {
          bridge.create(effect.step, effect.context, cause, effect.itemIndex)
          return
        }
        const rec = opts.getState().steps[effect.step]
        opts.send(
          {
            type: 'res.child',
            step: effect.step,
            token: { step: effect.step, runId: rec?.runId ?? 0 },
            summary: {
              status: 'failed',
              current: null,
              progress: 0,
              seq: (rec?.child?.seq ?? 0) + 1,
            },
            failed: {
              error: {
                name: 'WizardError',
                code: 'CHILD_UNSUPPORTED',
                message: 'nested flows are not enabled on this interpreter',
              },
            },
          },
          cause,
        )
        return
      }
      case 'child.send':
        bridge?.send(effect.step, effect.command)
        return
      case 'child.dispose':
        bridge?.dispose(effect.step)
        return
      case 'persist':
        opts.persist(effect.reason)
        return
      case 'settle':
        opts.settle(effect)
        return
    }
  }
}
