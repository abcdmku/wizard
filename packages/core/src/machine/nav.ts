/**
 * Navigation pipeline (§1): `next` / `go` / `back` transactions, the phase
 * machine (skip arrows are decided here; effects come from `plan`), commit,
 * auto-advance for non-view completions (§1.4) and the deferred auto-advance
 * queue (`nav.deferred`, drained whenever `nav` returns to idle).
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { EffectResult } from './commands'
import type { TransitionRejectReason } from './events'
import { enterStep, hasOnHandlers, schedule } from './scheduler'
import { cursorTarget, eligible, isTerminal, ready } from './selectors'
import type { Issue, NavCause, NavPhase, SerializedError } from './state'
import { normalizeTargets } from './util'
import { drainInbox } from './wait'

const PHASES_FULL: readonly NavPhase[] = [
  'parsingInput',
  'validating',
  'canExit',
  'resolvingTarget',
  'canEnter',
  'exiting',
  'entering',
]
const PHASES_TARGETED: readonly NavPhase[] = ['canEnter', 'exiting', 'entering']
const PHASES_AUTO: readonly NavPhase[] = ['resolvingTarget', 'canEnter', 'exiting', 'entering']

export const AUTO_ADVANCE_LIMIT = 1000

function phaseList(b: Batch): readonly NavPhase[] {
  const nav = b.state.nav
  const fromIsView = nav.from != null && stepDef(b, nav.from)?.kind === 'view'
  switch (nav.cause) {
    case 'next':
      return PHASES_FULL
    case 'go':
      return fromIsView ? PHASES_FULL : PHASES_TARGETED
    case 'back':
      return PHASES_TARGETED
    default:
      // cursor rule (from null) vs. auto-advance from a completed non-view step
      return nav.from == null ? PHASES_TARGETED : PHASES_AUTO
  }
}

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

function rejectCurrent(
  b: Batch,
  reason: TransitionRejectReason,
  opts: { step?: string; issues?: readonly Issue[] } = {},
): void {
  rejectNav(b, reason, { ...opts, txId: b.state.nav.txId ?? b.env.id('tx') })
}

function failCurrent(b: Batch, step: string, error: SerializedError): void {
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

function startTransaction(b: Batch, cause: NavCause, from: string | null, to?: string): void {
  const txId = b.env.id('tx')
  emit(b, { type: 'transition.started', txId, from, cause, ...(to !== undefined ? { to } : {}) })
  const first = phaseList(b)[0]
  if (first !== undefined) runPhases(b, first)
}

/** Cursor rule (§3.2.3): move the (null) cursor to the single ready view through a transaction. */
export function startCursorTransaction(b: Batch, cause: NavCause, view: string): void {
  startTransaction(b, cause, null, view)
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
// Phase machine
// ---------------------------------------------------------------------------

type PhaseOutcome = 'wait' | 'continue' | 'stop'

/** Walk phases from `start`; stop when a phase needs an effect result (or the tx ended); commit at the end. */
export function runPhases(b: Batch, start: NavPhase, targets?: readonly string[]): void {
  const list = phaseList(b)
  let i = list.indexOf(start)
  if (i < 0) return
  let known = targets
  while (i < list.length) {
    const phase = list[i]
    if (phase === undefined) return
    const outcome = enterPhase(b, phase, known)
    known = undefined
    if (outcome !== 'continue') return
    i++
  }
  commit(b)
}

function phaseEvent(b: Batch, phase: NavPhase, targets?: readonly string[]): void {
  emit(b, {
    type: 'transition.phase',
    txId: b.state.nav.txId ?? '',
    phase,
    ...(targets !== undefined ? { targets } : {}),
  })
}

function enterPhase(b: Batch, phase: NavPhase, targets?: readonly string[]): PhaseOutcome {
  const from = b.state.nav.from ?? null
  const fromDef = from !== null ? stepDef(b, from) : undefined
  switch (phase) {
    case 'parsingInput': {
      phaseEvent(b, phase)
      if (fromDef?.input !== undefined) return 'wait'
      if (from !== null) {
        const input = rec(b, from)?.input
        emit(b, { type: 'step.validated', step: from, output: input })
      }
      return 'continue'
    }
    case 'validating':
      phaseEvent(b, phase)
      return fromDef?.hooks.validate !== undefined ? 'wait' : 'continue'
    case 'canExit':
      phaseEvent(b, phase)
      return fromDef?.hooks.canExit !== undefined ? 'wait' : 'continue'
    case 'resolvingTarget':
      return resolveTargets(b, from, targets)
    case 'canEnter':
      phaseEvent(b, phase, targets)
      return (b.state.nav.pendingSteps?.length ?? 0) > 0 ? 'wait' : 'continue'
    case 'exiting':
      phaseEvent(b, phase)
      // A skipped `from` (v0.2) never entered: its `exit` hook does not run.
      return fromDef?.hooks.exit !== undefined && rec(b, from ?? '')?.status !== 'skipped'
        ? 'wait'
        : 'continue'
    case 'entering':
      phaseEvent(b, phase)
      return (b.state.nav.pendingSteps?.length ?? 0) > 0 ? 'wait' : 'continue'
    default:
      return 'stop'
  }
}

function resolveTargets(b: Batch, from: string | null, known?: readonly string[]): PhaseOutcome {
  const nav = b.state.nav
  if (known !== undefined) return applyTargets(b, from, known)
  if (nav.targets !== undefined) {
    phaseEvent(b, 'resolvingTarget')
    return 'continue'
  }
  const def = from !== null ? stepDef(b, from) : undefined
  if (def === undefined) {
    phaseEvent(b, 'resolvingTarget')
    rejectCurrent(b, 'no-target')
    return 'stop'
  }
  // A decision's output IS its target list — unless it was skipped (v0.2): then its `next`
  // hook is asked like any dynamic `next`.
  if (def.kind === 'decision' && rec(b, from ?? '')?.status !== 'skipped')
    return applyTargets(b, from, normalizeTargets(rec(b, from ?? '')?.output))
  if (def.next.kind === 'dynamic') {
    phaseEvent(b, 'resolvingTarget')
    return 'wait'
  }
  const targets = def.next.kind === 'static' ? def.next.targets : []
  return applyTargets(b, from, targets)
}

/** Record resolved targets (validated) via the `resolvingTarget` phase event. */
function applyTargets(b: Batch, from: string | null, targets: readonly string[]): PhaseOutcome {
  if (targets.length === 0) {
    phaseEvent(b, 'resolvingTarget')
    rejectCurrent(b, 'no-target', from !== null ? { step: from } : {})
    return 'stop'
  }
  const unknown = targets.find((t) => stepDef(b, t) === undefined)
  if (unknown !== undefined) {
    phaseEvent(b, 'resolvingTarget')
    failCurrent(b, from ?? unknown, {
      name: 'WizardError',
      message: `unknown next target '${unknown}'`,
      code: 'UNKNOWN_STEP',
    })
    return 'stop'
  }
  phaseEvent(b, 'resolvingTarget', targets)
  return 'continue'
}

// ---------------------------------------------------------------------------
// Commit (§1.3)
// ---------------------------------------------------------------------------

function commit(b: Batch): void {
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
  const explicit = cause === 'go' || cause === 'back'
  if (
    cursor !== undefined &&
    (explicit ? eligible(b.env.def, b.state, cursor) : ready(b.env.def, b.state, cursor))
  )
    enterStep(b, cursor, from)
  emit(b, { type: 'transition.committed', txId, from, to: first, cause, direction })
  schedule(b)
  onNavIdle(b)
}

// ---------------------------------------------------------------------------
// Effect results for transaction hooks (token.txId === nav.txId, checked by the caller)
// ---------------------------------------------------------------------------

export function onNavResult(
  b: Batch,
  msg: Extract<EffectResult, { type: 'res.ok' | 'res.err' }>,
): boolean {
  const nav = b.state.nav
  const from = nav.from ?? null
  const ok = msg.type === 'res.ok'
  const value = ok ? msg.value : undefined
  const error: SerializedError = ok ? { name: 'Error', message: '' } : msg.error
  switch (msg.hook) {
    case 'parseInput': {
      if (nav.phase !== 'parsingInput' || from === null) return false
      if (ok) {
        emit(b, { type: 'step.validated', step: from, output: value })
        runPhases(b, 'validating')
      } else {
        const issues = msg.issues ?? [{ message: error.message }]
        emit(b, { type: 'step.validationFailed', step: from, issues })
        rejectCurrent(b, 'validation', { step: from, issues })
      }
      return true
    }
    case 'validate': {
      if (nav.phase !== 'validating' || from === null) return false
      const issues: readonly Issue[] | undefined = ok
        ? Array.isArray(value) && value.length > 0
          ? (value as readonly Issue[])
          : undefined
        : (msg.issues ?? [{ message: error.message }])
      if (issues === undefined) {
        runPhases(b, 'canExit')
      } else {
        emit(b, { type: 'step.validationFailed', step: from, issues })
        rejectCurrent(b, 'validation', { step: from, issues })
      }
      return true
    }
    case 'canExit': {
      if (nav.phase !== 'canExit' || from === null) return false
      if (ok && value !== false) {
        emit(b, { type: 'step.guardEvaluated', step: from, hook: 'canExit', ok: true })
        runPhases(b, 'resolvingTarget')
      } else {
        emit(b, {
          type: 'step.guardEvaluated',
          step: from,
          hook: 'canExit',
          ok: false,
          ...(ok ? {} : { reason: error.message }),
        })
        rejectCurrent(b, 'guard-canExit', { step: from })
      }
      return true
    }
    case 'next': {
      if (nav.phase !== 'resolvingTarget' || from === null) return false
      if (ok) {
        const targets = normalizeTargets(value)
        if (targets.length === 0) {
          rejectCurrent(b, 'no-target', { step: from })
        } else {
          const unknown = targets.find((t) => stepDef(b, t) === undefined)
          if (unknown !== undefined) {
            failCurrent(b, from, {
              name: 'WizardError',
              message: `unknown next target '${unknown}'`,
              code: 'UNKNOWN_STEP',
            })
          } else {
            runPhases(b, 'canEnter', targets)
          }
        }
      } else {
        failCurrent(b, from, error)
      }
      return true
    }
    case 'canEnter': {
      const step = msg.token.step
      if (nav.phase !== 'canEnter' || !(nav.pendingSteps ?? []).includes(step)) return false
      if (ok && value !== false) {
        emit(b, { type: 'step.guardEvaluated', step, hook: 'canEnter', ok: true })
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) runPhases(b, 'exiting')
      } else {
        emit(b, {
          type: 'step.guardEvaluated',
          step,
          hook: 'canEnter',
          ok: false,
          ...(ok ? {} : { reason: error.message }),
        })
        rejectCurrent(b, 'guard-canEnter', { step })
      }
      return true
    }
    case 'exit': {
      if (nav.phase !== 'exiting' || from === null) return false
      if (ok) runPhases(b, 'entering')
      else failCurrent(b, from, error)
      return true
    }
    case 'enter': {
      const step = msg.token.step
      if (nav.phase !== 'entering' || !(nav.pendingSteps ?? []).includes(step)) return false
      if (ok) {
        // Atomic multi-target entry: commit only once every target's `enter` resolved.
        emit(b, { type: 'step.enterCompleted', step })
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) commit(b)
      } else failCurrent(b, step, error)
      return true
    }
    default:
      return false
  }
}
