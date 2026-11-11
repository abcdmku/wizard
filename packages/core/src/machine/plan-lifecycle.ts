/** Entry, compensation, and resume effect planning. @internal */

import type { Effect } from './effects'
import { call } from './plan-call'
import { DEFAULT_COMPENSATION_GRACE_MS } from './saga'
import { isRoutingStep, isRunnableStep, isTerminal } from './selectors'
import type { StepRecord, WizardState } from './state'
import type { MachineEnv } from './types'

export function planKindStart(
  env: MachineEnv,
  rec: StepRecord,
  out: Effect[],
  resume = false,
): void {
  const def = env.def.steps[rec.id]
  if (def === undefined) return
  if (def.each !== undefined) {
    if (rec.each === undefined) out.push(call(env, rec, 'each'))
    return
  }
  if (def.sleep !== undefined) {
    if (typeof def.sleep === 'function' && rec.deadline === undefined)
      out.push(call(env, rec, 'sleep'))
    return
  }
  switch (def.kind) {
    case 'step':
      if (isRoutingStep(def)) out.push(call(env, rec, 'next'))
      else if (
        resume &&
        isRunnableStep(def) &&
        rec.attempt === 0 &&
        def.hooks.idempotencyKey !== undefined
      )
        out.push(call(env, rec, 'idempotencyKey', { extra: { attempt: 1 } }))
      return
    case 'child':
      if (rec.child === undefined) out.push(call(env, rec, 'childContext'))
      return
    default:
      return
  }
}

export function planCompensate(
  env: MachineEnv,
  state: WizardState,
  rec: StepRecord,
  out: Effect[],
): void {
  const inFlight = state.saga.inFlight
  if (inFlight === undefined || inFlight.step !== rec.id) return
  if (rec.kind === 'child') {
    out.push({ kind: 'child.send', step: rec.id, command: { type: 'compensate' } })
    return
  }
  const entry = state.saga.stack.find(
    (item) => item.step === inFlight.step && item.runId === inFlight.runId,
  )
  const timeoutMs =
    env.def.steps[rec.id]?.timeoutMs ??
    env.def.policies.compensationGraceMs ??
    DEFAULT_COMPENSATION_GRACE_MS
  out.push(
    call(env, rec, 'compensate', {
      runId: inFlight.runId,
      timeoutMs,
      extra: {
        output: entry?.output,
        reason: state.saga.reason ?? null,
        idempotencyKey: `${state.instanceId}:${rec.id}:${inFlight.runId}:compensate`,
      },
    }),
  )
}

export function planResume(
  env: MachineEnv,
  state: WizardState,
  out: Effect[],
  fresh: ReadonlySet<string>,
): void {
  const initializing = new Set<string>()
  for (const [id, rec] of Object.entries(state.steps)) {
    if (fresh.has(id) || rec.initializing === undefined) continue
    initializing.add(id)
    out.push(call(env, rec, 'initial', { initialSeq: rec.initializing }))
  }
  for (const id of state.active) {
    const rec = state.steps[id]
    if (rec === undefined || fresh.has(id) || initializing.has(id)) continue
    if (rec.entering === true) {
      out.push(call(env, rec, 'enter', { extra: { from: null } }))
      continue
    }
    planKindStart(env, rec, out, true)
  }
  const live = !isTerminal(state) && state.status !== 'compensating'
  for (const [id, rec] of Object.entries(state.steps)) {
    if (fresh.has(id)) continue
    if (rec.status === 'compensating') planCompensate(env, state, rec, out)
    else if (live && rec.status !== 'active' && rec.when === 'pending')
      out.push(call(env, rec, 'when'))
  }
  const now = env.now()
  const timers = Object.entries(state.timers).sort((a, b) => a[1].at - b[1].at)
  for (const [timerId, entry] of timers) {
    out.push({ kind: 'timer.set', timerId, at: Math.max(entry.at, now), fire: entry.fire })
  }
}
