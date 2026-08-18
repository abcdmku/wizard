/** The toy machine's `plan`: hook calls, timers, child effects, settle / persist. */

import type { Effect } from '../../../src/machine/effects'
import type { DomainEvent } from '../../../src/machine/events'
import type { WizardState } from '../../../src/machine/state'
import type { MachineEnv } from '../../../src/machine/types'
import { targetsOf } from './toy-shared'

export function toyPlan(
  env: MachineEnv,
  S: WizardState,
  batch: readonly DomainEvent[],
): readonly Effect[] {
  const out: Effect[] = []
  const received = new Map<string, unknown>()
  for (const ev of batch) if (ev.type === 'event.received') received.set(ev.inboxId, ev.payload)
  for (const ev of batch) {
    switch (ev.type) {
      case 'step.runStarted': {
        const def = env.def.steps[ev.step]
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: ev.step,
          hook: 'run',
          token: { step: ev.step, runId: ev.runId, attempt: ev.attempt },
          extra: { attempt: ev.attempt },
          ...(def?.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
        })
        break
      }
      case 'transition.phase': {
        if (ev.phase !== 'canExit' || S.nav.from == null) break
        const from = S.nav.from
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: from,
          hook: 'canExit',
          token: { step: from, runId: S.steps[from]!.runId, txId: ev.txId },
          extra: { to: targetsOf(env, from)[0] },
        })
        break
      }
      case 'transition.committed':
        out.push({
          kind: 'settle',
          txId: ev.txId,
          outcome: 'ok',
          value: { from: ev.from, to: ev.to },
        })
        out.push({ kind: 'persist', reason: 'change' })
        break
      case 'transition.rejected':
        out.push({ kind: 'settle', txId: ev.txId, outcome: 'rejected' })
        break
      case 'transition.failed':
        out.push({ kind: 'settle', txId: ev.txId, outcome: 'failed', error: ev.error })
        break
      case 'event.delivered':
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: ev.to,
          hook: 'on',
          token: { step: ev.to, runId: S.steps[ev.to]!.runId },
          extra: { event: ev.event, payload: received.get(ev.inboxId), inboxId: ev.inboxId },
        })
        break
      case 'timer.scheduled':
        out.push({
          kind: 'timer.set',
          timerId: ev.timerId,
          at: ev.dueAt,
          fire: { type: 'timer.fired', timerId: ev.timerId },
        })
        break
      case 'timer.cleared':
        out.push({ kind: 'timer.clear', timerId: ev.timerId })
        break
      case 'step.entered': {
        const def = env.def.steps[ev.step]
        if (def?.kind === 'flow' && def.hooks.childContext !== undefined) {
          out.push({
            kind: 'call',
            effectId: env.id('fx'),
            step: ev.step,
            hook: 'childContext',
            token: { step: ev.step, runId: ev.runId },
          })
        }
        break
      }
      case 'child.started':
        out.push({ kind: 'child.create', step: ev.step, context: S.context })
        break
      case 'child.command':
        out.push({ kind: 'child.send', step: ev.step, command: ev.command })
        break
      case 'flow.done':
        out.push({ kind: 'persist', reason: 'final' })
        break
      case 'flow.reset':
        for (const timerId of Object.keys(S.timers)) out.push({ kind: 'timer.clear', timerId })
        break
      default:
        break
    }
  }
  return out
}
