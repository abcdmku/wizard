/**
 * Navigation pipeline (§1): `next` / `go` / `back` transactions, rejections, commit (§1.3),
 * auto-advance for non-view completions (§1.4) and the deferred auto-advance queue
 * (`nav.deferred`, drained whenever `nav` returns to idle). The phase machine and the
 * transaction hook results live in `nav-phases.ts`.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { TransitionRejectReason } from './events'
import { phaseList, runPhases } from './nav-phases'
import { enterStep, hasOnHandlers, schedule } from './scheduler'
import { cursorTarget, eligible, isExplicitCause, isTerminal, ready } from './selectors'
import type { Issue, NavCause, SerializedError } from './state'
import { normalizeTargets } from './util'
import { drainInbox } from './wait'

export const AUTO_ADVANCE_LIMIT = 1000

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

/** Reject before/without a transaction: fresh txId so the façade can settle its promise. */
export function rejectNav(
  b: Batch,
  reason: TransitionRejectReason,
  opts: { step?: string; issues?: readonly Issue[]; txId?: string; deferIdle?: boolean } = {},
): void {
  emit(b, {
    type: 'transition.rejected',
    txId: opts.txId ?? b.env.id('tx'),
    reason,
    ...(opts.step !== undefined ? { step: opts.step } : {}),
    ...(opts.issues !== undefined ? { issues: opts.issues } : {}),
  })
  // `deferIdle`: the caller runs `onNavIdle` itself once (resume) — one drain per batch.
  if (opts.deferIdle !== true) onNavIdle(b)
}

export function rejectCurrent(
  b: Batch,
  reason: TransitionRejectReason,
  opts: { step?: string; issues?: readonly Issue[] } = {},
): void {
  rejectNav(b, reason, { ...opts, txId: b.state.nav.txId ?? b.env.id('tx') })
}

export function failCurrent(b: Batch, step: string, error: SerializedError): void {
  emit(b, { type: 'transition.failed', txId: b.state.nav.txId ?? b.env.id('tx'), step, error })
  onNavIdle(b)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function navNext(b: Batch): void {
  const s = b.state
  if (s.nav.phase !== 'idle') {
    rejectNav(b, 'nav-busy')
    return
  }
  if (s.current === null) {
    rejectNav(b, 'not-active')
    return
  }
  startTransaction(b, 'next', s.current)
}

export function navGo(b: Batch, step: string): void {
  const s = b.state
  if (s.nav.phase !== 'idle') {
    rejectNav(b, 'nav-busy', { step })
    return
  }
  const def = stepDef(b, step)
  if (def === undefined || def.kind !== 'view') {
    rejectNav(b, 'not-a-view', { step })
    return
  }
  if (step === s.current) {
    rejectNav(b, 'not-reachable', { step })
    return
  }
  if (!ready(b.env.def, s, step) && (rec(b, step)?.visitedCount ?? 0) === 0) {
    rejectNav(b, 'not-reachable', { step })
    return
  }
  startTransaction(b, 'go', s.current, step)
}

export function navBack(b: Batch): void {
  const s = b.state
  if (s.nav.phase !== 'idle') {
    rejectNav(b, 'nav-busy')
    return
  }
  const prev = [...s.history].reverse().find((id) => id !== s.current)
  if (prev === undefined) {
    rejectNav(b, 'no-history')
    return
  }
  startTransaction(b, 'back', s.current, prev)
}

/** Start a transaction (`from` = the current view or null; `to` = an explicit target). */
export function startTransaction(
  b: Batch,
  cause: NavCause,
  from: string | null,
  to?: string,
): void {
  const txId = b.env.id('tx')
  emit(b, { type: 'transition.started', txId, from, cause, ...(to !== undefined ? { to } : {}) })
  const first = phaseList(b)[0]
  if (first !== undefined) runPhases(b, first)
}

// ---------------------------------------------------------------------------
// Auto-advance (§1.4)
// ---------------------------------------------------------------------------

/**
 * Non-view step completed: `step.done{next?}` → auto-advance (or defer while a
 * transition is in flight — `apply` queues it in `nav.deferred`) → schedule.
 */
export function completeStep(b: Batch, step: string, output: unknown, next?: string): void {
  emit(b, {
    type: 'step.done',
    step,
    ...(output !== undefined ? { output } : {}),
    ...(next !== undefined ? { next } : {}),
  })
  startAuto(b, step, next)
  schedule(b)
}

/**
 * Start the lightweight auto transaction from a completed non-view step — or (v0.2)
 * from a skipped step of any kind, whose `next` targets are arrived the same way.
 */
export function startAuto(b: Batch, from: string, override?: string): void {
  const s = b.state
  if (s.nav.phase !== 'idle') return
  if (isTerminal(s) || s.status === 'compensating') return
  const def = stepDef(b, from)
  if (def === undefined) return
  if (override === undefined) {
    if (def.kind === 'decision' && rec(b, from)?.status !== 'skipped') {
      if (normalizeTargets(rec(b, from)?.output).length === 0) return
    } else if (def.next.kind === 'none') {
      return
    }
  }
  if ((s.nav.hops ?? 0) >= AUTO_ADVANCE_LIMIT) {
    emit(b, {
      type: 'flow.failed',
      step: from,
      error: {
        name: 'WizardError',
        message: `auto-advance exceeded ${AUTO_ADVANCE_LIMIT} hops`,
        code: 'AUTO_ADVANCE_LOOP',
      },
      code: 'AUTO_ADVANCE_LOOP',
    })
    return
  }
  const txId = b.env.id('tx')
  emit(b, {
    type: 'transition.started',
    txId,
    from,
    cause: 'auto',
    ...(override !== undefined ? { to: override } : {}),
  })
  runPhases(b, 'resolvingTarget')
}

/**
 * `nav` just returned to idle: start the next deferred auto-advance, if any; otherwise
 * (v0.2) let the current view drain its inbox — a view listens for external events only
 * while `nav` is idle (§10.1), so events buffered while it was busy are delivered now.
 */
export function onNavIdle(b: Batch): void {
  const s = b.state
  if (s.nav.phase !== 'idle') return
  if (isTerminal(s) || s.status === 'compensating') return
  const d = s.nav.deferred?.[0]
  if (d !== undefined) {
    startAuto(b, d.step, d.to)
    return
  }
  const view = s.current
  if (view !== null && hasOnHandlers(b, view)) drainInbox(b, view)
}

/**
 * v0.2 (§10.1): a view's `on[event]` handler returned `{ next }` — an external event advances
 * the cursor through a transaction with `cause: 'event'`: `canEnter` (targets) → `exit` (view)
 * → `enter` (targets) → commit; no `parseInput` / `validate` / `canExit`. Requires an idle `nav`.
 */
export function startEventTransition(b: Batch, view: string, to: string): void {
  const txId = b.env.id('tx')
  emit(b, { type: 'transition.started', txId, from: view, cause: 'event', to })
  runPhases(b, 'resolvingTarget')
}

// ---------------------------------------------------------------------------
// Commit (§1.3)
// ---------------------------------------------------------------------------

export function commit(b: Batch): void {
  const nav = b.state.nav
  const from = nav.from ?? null
  const targets = nav.targets ?? []
  const first = targets[0]
  if (first === undefined) {
    rejectCurrent(b, 'no-target')
    return
  }
  const direction = nav.direction ?? 'forward'
  const cause = nav.cause ?? 'auto'
  const txId = nav.txId ?? b.env.id('tx')
  if (from !== null) {
    const fr = rec(b, from)
    if (fr?.kind === 'view' && fr.status === 'active')
      emit(b, { type: 'step.exited', step: from, to: first, direction })
  }
  for (const t of targets) {
    // A target that is already pending (cursor rule / `go` to a ready view) is not re-arrived.
    const tr = rec(b, t)
    if (tr?.pendingActivation === true && tr.status !== 'active') continue
    emit(b, { type: 'step.arrived', step: t, from })
  }
  const cursor = cursorTarget(b.env.def, b.state, targets, from)
  // v0.2: a `when` predicate gates automatic entry (`next` / auto / cursor rule); a view the user
  // navigated to explicitly (`go` / `back`) enters when eligible — explicit intent overrides `when`.
  const explicit = isExplicitCause(cause)
  if (
    cursor !== undefined &&
    (explicit ? eligible(b.env.def, b.state, cursor) : ready(b.env.def, b.state, cursor))
  )
    enterStep(b, cursor, from)
  emit(b, { type: 'transition.committed', txId, from, to: first, cause, direction })
  schedule(b)
  onNavIdle(b)
}
