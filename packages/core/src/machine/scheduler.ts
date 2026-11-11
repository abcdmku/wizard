/**
 * Scheduler — step entry, kind-specific start, readiness-driven scheduling
 * (§3), the `when` predicate + skipping (§10.2), concurrency budget,
 * cancellation and the failure policy dispatch (§5.2).
 *
 * All functions append events to a `Batch` (see `batch.ts`).
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import { completeStep, startAuto, startTransaction } from './nav'
import { synchronizeNeeds } from './needs'
import {
  activeRunCount,
  eligibleSteps,
  explicitTarget,
  isEventStep,
  isRunnableStep,
  isTerminal,
  ready,
  readySteps,
  readyViews,
  viewsAwaitingWhen,
} from './selectors'
import { startSleep } from './sleep'
import type { NavCause } from './state'
import { stepIndex } from './step-index'
import { drainInbox, startWait } from './wait'

export { failStep } from './failure'

export const retryTimerId = (step: string) => `retry:${step}`
export const waitTimerId = (step: string) => `wait:${step}`
export const inboxTimerId = (inboxId: string) => `inbox:${inboxId}`

/** Default idempotency key (`hooks.idempotencyKey` overrides it, see `startKind`). */
export function idempotencyKey(b: Batch, step: string, runId: number): string {
  return `${b.state.instanceId}:${step}:${runId}`
}

/** The key of the current run: the stored one (custom or default, set by `step.runStarted`), else the default. */
export function currentIdempotencyKey(b: Batch, step: string, runId: number): string {
  return rec(b, step)?.idempotencyKey ?? idempotencyKey(b, step, runId)
}

/** Clear every timer owned by the step, including retries of individual map items. */
export function clearStepTimers(b: Batch, step: string): void {
  for (const [id, timer] of Object.entries(b.state.timers)) {
    if (timer.step === step) emit(b, { type: 'timer.cleared', timerId: id })
  }
}

/**
 * Nothing new may enter: terminal, compensating, not started, or halted by a failed step of this
 * run (a run halted only because a child flow halted keeps scheduling its other branches).
 */
export function schedulingFrozen(b: Batch): boolean {
  const s = b.state.status
  if (s === 'halted') return stepIndex(b.state.steps).failed > 0
  return isTerminal(b.state) || s === 'compensating' || s === 'idle'
}

/** The step declares at least one `on[event]` handler (v0.2: any kind). */
export function hasEventHandlers(b: Batch, step: string): boolean {
  const hooks = stepDef(b, step)?.hooks
  const handlers = hooks?.waitFor ?? hooks?.on
  return handlers !== undefined && Object.keys(handlers).length > 0
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Enter a step: `step.entered` (+ `entering` sub-phase when an `enter` hook must
 * still run), then kind-specific start events unless the hook is pending.
 * `rec.enterDone` = the hook already ran during a transition's `entering` phase.
 */
export function enterStep(b: Batch, step: string, from: string | null): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined) return
  const initialPending =
    def.kind === 'view' && def.hooks.initial !== undefined && r.input === undefined
  const pending = initialPending || (def.hooks.enter !== undefined && r.enterDone !== true)
  emit(b, {
    type: 'step.entered',
    step,
    from,
    runId: r.runId + 1,
    ...(pending ? { enterPending: true } : {}),
  })
  if (!pending) startKind(b, step)
}

/** Continue a scheduler entry after a dynamic draft initializer stored its result. */
export function continueAfterInitial(b: Batch, step: string): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r?.entering !== true || def === undefined) return
  if (def.hooks.enter !== undefined) return
  emit(b, { type: 'step.enterCompleted', step })
  startKind(b, step)
}

/** Kind-specific work once `enter` has resolved (or when there is no `enter` hook). */
export function startKind(b: Batch, step: string): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined || r.status !== 'active') return
  if (def.sleep !== undefined) {
    startSleep(b, step)
    return
  }
  if (isEventStep(def)) {
    startWait(b, step)
    return
  }
  if (def.each !== undefined) return
  switch (def.kind) {
    case 'step':
      if (!isRunnableStep(def) && def.next.kind !== 'dynamic') {
        completeStep(b, step, undefined)
        return
      }
      if (!isRunnableStep(def)) break
      if (def.hooks.idempotencyKey !== undefined) {
        // v0.2 (§10.4): the custom key is computed first; `step.runStarted` follows with its value.
        emit(b, { type: 'step.idempotencyKeyRequested', step, runId: r.runId })
      } else {
        emit(b, {
          type: 'step.runStarted',
          step,
          attempt: 1,
          runId: r.runId,
          idempotencyKey: idempotencyKey(b, step, r.runId),
        })
      }
      break
    default:
      // A view waits for the cursor. A child flow starts through `plan`.
      break
  }
  // v0.2 (§10.1): a listening step drains its inbox on start (views: once `nav` is idle, see `onNavIdle`).
  if (def.kind !== 'view' && hasEventHandlers(b, step)) drainInbox(b, step)
}

// ---------------------------------------------------------------------------
// Scheduling (§3.2)
// ---------------------------------------------------------------------------

export interface ScheduleOptions {
  /** Run step 2 even when `autoRun === 'manual'` (`runReady`). */
  readonly force?: boolean
  /** Cause recorded by the cursor rule's `transition.committed` (default 'auto'; `start` uses 'start'). */
  readonly cursorCause?: NavCause
}

export function schedule(b: Batch, opts: ScheduleOptions = {}): void {
  if (schedulingFrozen(b)) return
  synchronizeNeeds(b)
  const def = b.env.def
  // v0.2 (§10.2): eligible steps with an unevaluated `when` predicate ask it first (any kind, any
  // autoRun) — except the target of an in-flight `go` / `back`, whose `when` is bypassed.
  for (const id of eligibleSteps(def, b.state)) {
    if (
      def.steps[id]?.hooks.when !== undefined &&
      rec(b, id)?.when === undefined &&
      !explicitTarget(b.state, id)
    ) {
      emit(b, { type: 'step.whenStarted', step: id })
    }
  }
  if (def.policies.autoRun === 'ready' || opts.force === true) {
    let budget = def.policies.concurrency - activeRunCount(def, b.state)
    for (const id of readySteps(def, b.state)) {
      // A synchronous routing or buffered wait can schedule this candidate in a nested call.
      if (!ready(def, b.state, id)) continue
      const kind = def.steps[id]?.kind
      if (kind === undefined || kind === 'view') continue
      if (isRunnableStep(def.steps[id])) {
        if (budget <= 0) continue
        budget--
      }
      enterStep(b, id, null)
      if (schedulingFrozen(b)) return
      if (!isRunnableStep(def.steps[id]))
        budget = def.policies.concurrency - activeRunCount(def, b.state)
    }
  }
  cursorRule(b, opts.cursorCause ?? 'auto')
}

/**
 * If no view is current and exactly one view is ready, the cursor moves there —
 * through a (lightweight) transaction so `canEnter`/`enter` run before commit.
 * v0.2: the rule waits while an eligible view's `when` is unresolved, and among
 * several ready views it prefers `nav.cursorHint` (the target a committed
 * transition wanted but could not enter yet).
 */
function cursorRule(b: Batch, cause: NavCause): void {
  const s = b.state
  if (s.current !== null || s.nav.phase !== 'idle') return
  if (viewsAwaitingWhen(b.env.def, s).length > 0) return
  const views = readyViews(b.env.def, s)
  const hint = s.nav.cursorHint
  const view =
    views.length === 1 ? views[0] : hint !== undefined && views.includes(hint) ? hint : undefined
  if (view === undefined) return
  startTransaction(b, cause, null, view)
}

// ---------------------------------------------------------------------------
// Completion / cancellation / failure / skipping
// ---------------------------------------------------------------------------

/** `step.cancelled` + timer cleanup. */
export function cancelStep(b: Batch, step: string, reason?: string): void {
  if (rec(b, step)?.status !== 'active') return
  clearStepTimers(b, step)
  emit(b, { type: 'step.cancelled', step, ...(reason !== undefined ? { reason } : {}) })
}

/** Cancel every active step (in activation order). */
export function cancelAllActive(b: Batch, reason?: string): void {
  for (const id of [...b.state.active]) cancelStep(b, id, reason)
}

/**
 * v0.2 (§10.2): skip a step — done without running. `step.skipped { reason }`, then its `next`
 * targets are arrived through the auto-advance transaction (dynamic `next` is resolved by a
 * `next` call first; a skipped step runs no other hook), then schedule.
 */
export function skipStep(b: Batch, step: string, reason: 'when' | 'command'): void {
  emit(b, { type: 'step.skipped', step, reason })
  startAuto(b, step)
  schedule(b)
}
