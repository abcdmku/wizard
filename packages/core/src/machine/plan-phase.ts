/**
 * Effects of a navigation transaction phase (`transition.phase`): the hook call the phase waits
 * for — `parseInput` / `validate` / `canExit` / dynamic `next` on the source, `canEnter` / `enter`
 * on the pending targets, `exit` on the source — only while the state is still parked in it.
 * @internal
 */

import type { Effect } from './effects'
import type { DomainEvent } from './events'
import { call } from './plan-call'
import { isRoutingStep } from './selectors'
import type { WizardState } from './state'
import type { MachineEnv } from './types'

export function planPhase(
  env: MachineEnv,
  state: WizardState,
  ev: Extract<DomainEvent, { type: 'transition.phase' }>,
  out: Effect[],
): void {
  const nav = state.nav
  if (nav.phase !== ev.phase || nav.txId !== ev.txId) return
  const txId = ev.txId
  const from = nav.from != null ? state.steps[nav.from] : undefined
  const targets = nav.targets ?? []
  const to = targets[0] ?? null
  switch (ev.phase) {
    case 'parsingInput':
      if (from !== undefined) out.push(call(env, from, 'parseInput', { txId }))
      return
    case 'validating':
      if (from !== undefined)
        out.push(call(env, from, 'validate', { txId, extra: { input: from.output } }))
      return
    case 'canExit':
      if (from !== undefined) out.push(call(env, from, 'canExit', { txId, extra: { to } }))
      return
    case 'resolvingTarget':
      // A routing step's targets are its output; a skipped step follows its ordinary transition.
      if (
        from !== undefined &&
        (!isRoutingStep(env.def.steps[from.id]) || from.status === 'skipped') &&
        env.def.steps[from.id]?.next.kind === 'dynamic'
      ) {
        out.push(call(env, from, 'next', { txId, extra: { output: from.output } }))
      }
      return
    case 'canEnter':
      for (const t of nav.pendingSteps ?? []) {
        const rec = state.steps[t]
        if (rec !== undefined)
          out.push(call(env, rec, 'canEnter', { txId, extra: { from: nav.from ?? null } }))
      }
      return
    case 'exiting':
      if (from !== undefined) out.push(call(env, from, 'exit', { txId, extra: { to } }))
      return
    case 'entering':
      for (const t of nav.pendingSteps ?? []) {
        const rec = state.steps[t]
        if (rec === undefined) continue
        if (rec.initializing !== undefined) {
          if (rec.initializing === ev.seq)
            out.push(call(env, rec, 'initial', { initialSeq: rec.initializing }))
        } else {
          out.push(call(env, rec, 'enter', { txId, extra: { from: nav.from ?? null } }))
        }
      }
      return
    default:
      return
  }
}
