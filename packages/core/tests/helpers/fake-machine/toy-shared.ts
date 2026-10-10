/** Helpers shared by the toy machine's decide / apply: entering a step, static advance, commit. */

import type { DomainEventBody } from '../../../src/machine/events'
import type { WizardState, WizardStatus } from '../../../src/machine/state'
import type { MachineEnv } from '../../../src/machine/types'

export const TERMINAL: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

/** Events that arrive at + enter `id` (and kick off kind-specific work). */
export function enterEvents(
  env: MachineEnv,
  state: WizardState,
  id: string,
  from: string | null,
): DomainEventBody[] {
  const rec = state.steps[id]
  const def = env.def.steps[id]
  if (rec === undefined || def === undefined) return []
  const runId = rec.runId + 1
  const out: DomainEventBody[] = [
    { type: 'step.arrived', step: id, from },
    { type: 'step.entered', step: id, from, runId },
  ]
  switch (def.kind) {
    case 'task':
      out.push({
        type: 'step.runStarted',
        step: id,
        attempt: 1,
        runId,
        idempotencyKey: `${state.instanceId}:${id}:${runId}`,
      })
      break
    case 'wait':
      if (def.waitTimeout !== undefined) {
        out.push({
          type: 'timer.scheduled',
          timerId: `wait:${id}`,
          dueAt: env.now() + def.waitTimeout.afterMs,
          purpose: 'waitTimeout',
        })
      }
      break
    case 'flow':
      if (def.hooks.childContext === undefined)
        out.push({ type: 'child.started', step: id, childPath: [...env.path, id] })
      break
    case 'final':
      out.push({ type: 'step.done', step: id }, { type: 'flow.done' })
      break
    default:
      break
  }
  return out
}

/** Static `next` of `id`, or [] . */
export function targetsOf(env: MachineEnv, id: string): readonly string[] {
  const next = env.def.steps[id]?.next
  return next?.kind === 'static' ? next.targets : []
}

export function advance(env: MachineEnv, state: WizardState, from: string): DomainEventBody[] {
  const out: DomainEventBody[] = []
  for (const target of targetsOf(env, from)) out.push(...enterEvents(env, state, target, from))
  return out
}

export function commitTransition(
  env: MachineEnv,
  state: WizardState,
  txId: string,
  from: string,
  cause: 'next' | 'go' | 'back',
): DomainEventBody[] {
  const to = targetsOf(env, from)[0]
  if (to === undefined)
    return [{ type: 'transition.rejected', txId, reason: 'no-target', step: from }]
  return [
    { type: 'step.exited', step: from, to, direction: 'forward' },
    ...enterEvents(env, state, to, from),
    { type: 'transition.committed', txId, from, to, cause, direction: 'forward' },
  ]
}
