/**
 * `explain(def, state, stepId)` — why a step is (not) where the user expects.
 *
 * Pure query over selectors; reason codes are stable strings the façade and
 * devtools can match on:
 * `unknown-step`, `flow-not-started`, `flow-terminal`, `flow-compensating`,
 * `nav-busy`, `not-activated`, `deps-unmet:<id>`, `guard-false:canEnter`,
 * `guard-false:canExit`, `concurrency-limit`, `auto-run-manual`,
 * `failed:<kind>`, `not-current`, `entering`, `retrying`.
 * `candidates` = ready views the cursor could move to.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import {
  activeTaskCount,
  isNavBusy,
  isTerminal,
  phase,
  ready,
  readyViews,
  type StepPhase,
  unmetDeps,
} from './selectors'
import type { StepStatus, WizardState } from './state'

export interface Explanation {
  readonly status: StepStatus | 'unknown'
  readonly phase: StepPhase | undefined
  readonly reasons: readonly string[]
  readonly candidates: readonly string[]
}

export function explain(def: CompiledFlow, state: WizardState, stepId: string): Explanation {
  const rec = state.steps[stepId]
  const candidates = readyViews(def, state).filter((id) => id !== state.current)
  if (rec === undefined)
    return { status: 'unknown', phase: undefined, reasons: ['unknown-step'], candidates }
  const reasons: string[] = []
  if (state.status === 'idle') reasons.push('flow-not-started')
  else if (isTerminal(state)) reasons.push('flow-terminal')
  else if (state.status === 'compensating') reasons.push('flow-compensating')
  if (isNavBusy(state)) reasons.push('nav-busy')

  if (rec.status === 'active') {
    if (rec.entering === true) reasons.push('entering')
    if (rec.kind === 'view' && state.current !== stepId) reasons.push('not-current')
    if (rec.retryAt !== undefined) reasons.push('retrying')
  } else if (rec.status === 'failed') {
    reasons.push(`failed:${rec.error?.kind ?? 'unknown'}`)
  } else if (
    rec.status === 'idle' ||
    rec.status === 'done' ||
    rec.status === 'skipped' ||
    rec.status === 'cancelled'
  ) {
    if (!rec.pendingActivation) reasons.push('not-activated')
    for (const dep of unmetDeps(def, state, stepId)) reasons.push(`deps-unmet:${dep}`)
    if (ready(def, state, stepId)) {
      const stepDef = def.steps[stepId]
      if (stepDef?.kind === 'task' && activeTaskCount(def, state) >= def.policies.concurrency)
        reasons.push('concurrency-limit')
      if (stepDef !== undefined && stepDef.kind !== 'view' && def.policies.autoRun === 'manual')
        reasons.push('auto-run-manual')
    }
  }
  if (rec.guards.canEnter?.ok === false) reasons.push('guard-false:canEnter')
  if (rec.guards.canExit?.ok === false) reasons.push('guard-false:canExit')

  return { status: rec.status, phase: phase(def, state, stepId), reasons, candidates }
}
