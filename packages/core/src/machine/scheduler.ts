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
import { startAuto, startCursorTransaction } from './nav'
import { startCompensation } from './saga'
import {
  activeTaskCount,
  awaitingWhen,
  eligibleSteps,
  isTerminal,
  readySteps,
  readyViews,
  viewsAwaitingWhen,
} from './selectors'
import type { NavCause, SerializedError } from './state'
import { drainInbox, startWait } from './wait'

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

/** Emit `timer.cleared` for the step's retry / wait timers if they exist. */
export function clearStepTimers(b: Batch, step: string): void {
  for (const id of [retryTimerId(step), waitTimerId(step)]) {
    if (id in b.state.timers) emit(b, { type: 'timer.cleared', timerId: id })
  }
}

/** Nothing new may enter: terminal, compensating, or halted (`onFailure:'halt'` after a failure). */
export function schedulingFrozen(b: Batch): boolean {
  const s = b.state.status
  return isTerminal(b.state) || s === 'compensating' || s === 'failed' || s === 'idle'
}

/** The step declares at least one `on[event]` handler (v0.2: any kind). */
export function hasOnHandlers(b: Batch, step: string): boolean {
  const on = stepDef(b, step)?.hooks.on
  return on !== undefined && Object.keys(on).length > 0
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
  const pending = def.hooks.enter !== undefined && r.enterDone !== true
  emit(b, {
    type: 'step.entered',
    step,
    from,
    runId: r.runId + 1,
    ...(pending ? { enterPending: true } : {}),
  })
  if (!pending) startKind(b, step)
}

/** Kind-specific work once `enter` has resolved (or when there is no `enter` hook). */
export function startKind(b: Batch, step: string): void {
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined || r.status !== 'active') return
  switch (def.kind) {
    case 'task':
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
    case 'wait':
      startWait(b, step)
      return
    case 'final':
      if (def.hooks.finalOutput === undefined) completeFinal(b, step, undefined)
      return
    default:
      // view: waits for the cursor; decision/flow: `plan` emits the `next` / `childContext` call.
      break
  }
  // v0.2 (§10.1): a listening step drains its inbox on start (views: once `nav` is idle, see `onNavIdle`).
  if (def.kind !== 'view' && hasOnHandlers(b, step)) drainInbox(b, step)
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
  const def = b.env.def
  // v0.2 (§10.2): eligible steps with an unevaluated `when` predicate ask it first (any kind, any autoRun).
  for (const id of eligibleSteps(def, b.state)) {
    if (def.steps[id]?.hooks.when !== undefined && rec(b, id)?.when === undefined) {
      emit(b, { type: 'step.whenStarted', step: id })
    }
  }
  if (def.policies.autoRun === 'ready' || opts.force === true) {
    let budget = def.policies.concurrency - activeTaskCount(def, b.state)
    for (const id of readySteps(def, b.state)) {
      const kind = def.steps[id]?.kind
      if (kind === undefined || kind === 'view') continue
      if (kind === 'task') {
        if (budget <= 0) continue
        budget--
      }
      enterStep(b, id, null)
      if (schedulingFrozen(b)) return
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
  startCursorTransaction(b, cause, view)
}

// ---------------------------------------------------------------------------
// Completion / cancellation / failure / skipping
// ---------------------------------------------------------------------------

/** `final` reached: cancel every other active step, then `step.done` + `flow.done`. */
export function completeFinal(b: Batch, step: string, output: unknown): void {
  for (const id of [...b.state.active]) if (id !== step) cancelStep(b, id, 'flow-done')
  emit(b, { type: 'step.done', step, ...(output !== undefined ? { output } : {}) })
  emit(b, { type: 'flow.done', ...(output !== undefined ? { output } : {}) })
}

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

/**
 * A step failed for good: record `step.failed`, then apply the flow's failure
 * policy. `interrupted` failures never trigger compensation (the user `retry`s).
 * `data` (v0.2) = the task's `mapError` value.
 */
export function failStep(
  b: Batch,
  step: string,
  error: SerializedError,
  kind: 'run' | 'timeout' | 'hook' | 'child' | 'sync-violation' | 'interrupted',
  data?: unknown,
): void {
  clearStepTimers(b, step)
  emit(b, { type: 'step.failed', step, error, kind, ...(data !== undefined ? { data } : {}) })
  if (b.env.def.policies.onFailure === 'compensate' && kind !== 'interrupted') {
    startCompensation(b, `step-failed:${step}`, 'failed')
    return
  }
  emit(b, { type: 'flow.failed', step, error, code: 'STEP_FAILED' })
}

/** True when `step` is eligible but its `when` predicate is still unresolved (for rejection reasons). */
export function whenPending(b: Batch, step: string): boolean {
  return awaitingWhen(b.env.def, b.state, step)
}
