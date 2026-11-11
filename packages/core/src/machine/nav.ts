/**
 * Navigation pipeline (§1): `next` / `go` / `back` transactions, rejections, commit (§1.3),
 * auto-advance for non-view completions (§1.4) and the deferred auto-advance queue
 * (`nav.deferred`, drained whenever `nav` returns to idle). The phase machine and the
 * transaction hook results live in `nav-phases.ts`.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, nextHop, rec, stepDef } from './batch'
import type { TransitionRejectReason } from './events'
import { phaseList, runPhases } from './nav-phases'
import { activateFeeds, propagateSkipped } from './needs'
import { enterStep, failStep, hasEventHandlers, schedule, schedulingFrozen } from './scheduler'
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

/**
 * The transaction failed. When it was the auto-advance of a non-view step (its `next` threw,
 * rejected or named an unknown step; its `exit` threw), that step fails under the flow's failure
 * policy: a broken route never lets the run finish `done` (D4). A view's transaction is only
 * rejected (the user is still on the view).
 */
export function failCurrent(b: Batch, step: string, error: SerializedError): void {
  const nav = b.state.nav
  emit(b, { type: 'transition.failed', txId: nav.txId ?? b.env.id('tx'), step, error })
  const from = nav.from
  if (nav.cause === 'auto' && from != null && stepDef(b, from)?.kind !== 'view')
    failStep(b, from, error, 'hook')
  onNavIdle(b)
}

/** Close navigation before cancellation without scheduling more work or evaluating a guard. */
export function abortCurrent(b: Batch, step?: string): void {
  const nav = b.state.nav
  if (nav.phase === 'idle' || nav.txId === undefined) return
  const affected = step ?? nav.from ?? nav.pendingSteps?.[0] ?? nav.targets?.[0]
  if (affected === undefined) return
  emit(b, {
    type: 'transition.failed',
    txId: nav.txId,
    step: affected,
    error: { name: 'AbortError', code: 'CANCELLED', message: 'navigation cancelled' },
  })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function navNext(b: Batch): void {
  const s = b.state
  if (s.nav.phase !== 'idle' || (s.current !== null && rec(b, s.current)?.entering === true)) {
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
  if (s.nav.phase !== 'idle' || (s.current !== null && rec(b, s.current)?.entering === true)) {
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
  if (s.nav.phase !== 'idle' || (s.current !== null && rec(b, s.current)?.entering === true)) {
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
export function completeStep(
  b: Batch,
  step: string,
  output: unknown,
  next?: string | readonly string[],
): void {
  emit(b, {
    type: 'step.done',
    step,
    ...(output !== undefined ? { output } : {}),
    ...(next !== undefined ? { next } : {}),
  })
  activateFeeds(b, step)
  startAuto(b, step, next)
  schedule(b)
}

/**
 * Start the lightweight auto transaction from a completed non-view step — or (v0.2)
 * from a skipped step of any kind, whose `next` targets are arrived the same way.
 */
export function startAuto(b: Batch, from: string, override?: string | readonly string[]): void {
  const s = b.state
  if (s.nav.phase !== 'idle') return
  if (isTerminal(s) || s.status === 'compensating') return
  const def = stepDef(b, from)
  if (def === undefined) return
  if (override === undefined && def.next.kind === 'none' && def.hooks.exit === undefined) return
  const hops = nextHop(b)
  // An acyclic flow advances at most once per step between async boundaries: the guard only trips on loops.
  const limit = AUTO_ADVANCE_LIMIT + b.env.def.order.length
  if (hops > limit) {
    const cycle = [...(s.nav.trail ?? []), from].map((id) => `'${id}'`).join(' → ')
    emit(b, {
      type: 'flow.failed',
      step: from,
      error: {
        name: 'WizardError',
        message: `auto-advance made ${limit} synchronous hops without an async boundary (a sync 'next' loop?); last steps: ${cycle}`,
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
    hops,
    ...(typeof override === 'string' ? { to: override } : {}),
  })
  runPhases(b, 'resolvingTarget', override === undefined ? undefined : normalizeTargets(override))
}

/**
 * `nav` just returned to idle: start the next deferred auto-advance, if any; otherwise
 * (v0.2) let the current view drain its inbox — a view listens for external events only
 * while `nav` is idle (§10.1), so events buffered while it was busy are delivered now.
 */
export function onNavIdle(b: Batch): void {
  const s = b.state
  if (s.nav.phase !== 'idle') return
  if (schedulingFrozen(b)) return
  const d = s.nav.deferred?.[0]
  if (d !== undefined) {
    startAuto(b, d.step, d.to)
    return
  }
  const view = s.current
  if (view !== null && hasEventHandlers(b, view)) drainInbox(b, view)
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

  const direction = nav.direction ?? 'forward'
  const cause = nav.cause ?? 'auto'
  const txId = nav.txId ?? b.env.id('tx')
  if (from !== null) {
    const fr = rec(b, from)
    if (fr?.kind === 'view' && fr.status === 'active') {
      emit(b, { type: 'step.exited', step: from, to: first ?? null, direction })
      if (direction !== 'back') activateFeeds(b, from)
    }
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
  emit(b, { type: 'transition.committed', txId, from, to: first ?? null, cause, direction })
  if (from !== null && (cause === 'next' || cause === 'auto')) {
    const next = stepDef(b, from)?.next
    if (next?.kind === 'dynamic' && next.targets !== undefined) {
      const chosen = new Set(targets)
      const skipped: string[] = []
      for (const target of next.targets) {
        const record = rec(b, target)
        if (chosen.has(target) || record === undefined) continue
        if (record.status !== 'idle' && !record.pendingActivation) continue
        emit(b, { type: 'step.skipped', step: target, reason: 'not-taken' })
        skipped.push(target)
      }
      propagateSkipped(b, skipped)
    }
  }
  schedule(b)
  onNavIdle(b)
}
