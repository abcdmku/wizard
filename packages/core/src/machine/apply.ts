/**
 * `apply` — the fold. One reducer per event type (exhaustive switch), then a
 * post-pass that recomputes `active`, `current`, `status` (`deriveStatus`),
 * `updatedAt` and `seq` after EVERY event.
 *
 * `apply` never emits events and never looks at hooks; it only reads the
 * compiled flow for structural facts (kind, dependsOn, initial input, which
 * steps have a `compensate` hook).
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { DomainEvent } from './events'
import { initialState } from './initial'
import {
  awaitingWhen,
  cursorInitiated,
  depsSatisfied,
  isTerminal,
  runInFlight,
  sameEntry,
} from './selectors'
import type {
  InboxEntry,
  NavState,
  SagaState,
  StepError,
  StepRecord,
  TimerEntry,
  WizardState,
  WizardStatus,
} from './state'
import type { MachineEnv } from './types'
import { isPlainObject, omit } from './util'

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

type RecPatch = Partial<StepRecord>
type RecKey = keyof StepRecord

function withStep(
  state: WizardState,
  id: string,
  fn: (rec: StepRecord) => StepRecord,
): WizardState {
  const rec = state.steps[id]
  if (rec === undefined) return state
  return { ...state, steps: { ...state.steps, [id]: fn(rec) } }
}

function patchStep(
  state: WizardState,
  id: string,
  patch: RecPatch,
  clear: readonly RecKey[] = [],
): WizardState {
  return withStep(state, id, (rec) => ({ ...omit(rec, clear), ...patch }) as StepRecord)
}

function withNav(state: WizardState, nav: NavState): WizardState {
  return { ...state, nav }
}

function withSaga(state: WizardState, saga: SagaState): WizardState {
  return { ...state, saga }
}

function withTimer(state: WizardState, timerId: string, entry: TimerEntry): WizardState {
  return { ...state, timers: { ...state.timers, [timerId]: entry } }
}

function withoutTimer(state: WizardState, timerId: string): WizardState {
  if (!(timerId in state.timers)) return state
  return { ...state, timers: omit(state.timers, [timerId]) }
}

function withoutInbox(state: WizardState, inboxId: string): WizardState {
  if (!state.inbox.some((e) => e.id === inboxId)) return state
  return { ...state, inbox: state.inbox.filter((e) => e.id !== inboxId) }
}

function toStepError(
  error: { readonly name: string; readonly message: string; readonly code?: string },
  kind: StepError['kind'],
  at: number,
  attempt?: number,
  data?: unknown,
): StepError {
  const e: StepError = { name: error.name, message: error.message, kind, at }
  return {
    ...e,
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(data !== undefined ? { data } : {}),
  }
}

/** Idle nav that keeps the cross-transaction bookkeeping (`hops`, `deferred`, `cursorHint`). */
function idleNav(nav: NavState): NavState {
  const out: NavState = { phase: 'idle' }
  return {
    ...out,
    ...(nav.hops !== undefined ? { hops: nav.hops } : {}),
    ...(nav.deferred !== undefined && nav.deferred.length > 0 ? { deferred: nav.deferred } : {}),
    ...(nav.cursorHint !== undefined ? { cursorHint: nav.cursorHint } : {}),
  }
}

/** Forget the cursor hint when it points at `step` (the view entered, was skipped, invalidated, …). */
function dropHint(state: WizardState, step: string): WizardState {
  if (state.nav.cursorHint !== step) return state
  return withNav(state, omit(state.nav, ['cursorHint']))
}

/**
 * v0.2: a completed transition could not enter its cursor target because the target's `when`
 * predicate is unresolved → remember it so the cursor rule prefers it once the predicate passes.
 * Same admission rule as `cursorTarget` (a background auto-advance never steals the cursor).
 */
function pendingCursor(
  def: CompiledFlow,
  state: WizardState,
  targets: readonly string[],
  from: string | null,
): string | undefined {
  if (state.current !== null && from !== state.current) return undefined
  return targets.find((t) => {
    const rec = state.steps[t]
    return (
      rec !== undefined &&
      rec.kind === 'view' &&
      rec.status !== 'active' &&
      rec.pendingActivation &&
      depsSatisfied(def, state, t) &&
      awaitingWhen(def, state, t)
    )
  })
}

/**
 * v0.2: a non-view step that completed (`step.done`) or was skipped while a transition was in
 * flight continues (auto-advance) once `nav` is idle again: queue it in `nav.deferred`.
 */
function deferContinuation(
  def: CompiledFlow,
  state: WizardState,
  step: string,
  override: string | undefined,
): WizardState {
  const stepDef = def.steps[step]
  const busy = state.nav.phase !== 'idle' && state.status !== 'compensating' && !isTerminal(state)
  const advances =
    stepDef !== undefined &&
    stepDef.kind !== 'final' &&
    (override !== undefined || stepDef.next.kind !== 'none')
  if (!busy || !advances) return state
  const entry = override !== undefined ? { step, to: override } : { step }
  return withNav(state, { ...state.nav, deferred: [...(state.nav.deferred ?? []), entry] })
}

/** Clear transient entry markers on the targets of a transaction that did not commit. */
function clearEnterMarkers(
  state: WizardState,
  targets: readonly string[] | undefined,
): WizardState {
  let next = state
  for (const t of targets ?? []) {
    const rec = next.steps[t]
    if (rec?.entering === true || rec?.enterDone === true) {
      next = patchStep(next, t, {}, ['entering', 'enterDone'])
    }
  }
  return next
}

// ---------------------------------------------------------------------------
// Status derivation (§5.1) — the ONE place wizard status is computed
// ---------------------------------------------------------------------------

export function deriveStatus(
  def: CompiledFlow,
  state: WizardState,
  event: DomainEvent,
): WizardStatus {
  switch (event.type) {
    case 'flow.done':
      return 'done'
    case 'flow.compensated':
      return event.outcome
    case 'flow.cancelled':
      return 'cancelled'
    case 'flow.failed':
      return 'failed'
    case 'flow.compensating':
      return 'compensating'
    case 'flow.reset':
      return 'idle'
    default:
      break
  }
  const prev = state.status
  if (prev === 'done' || prev === 'cancelled' || prev === 'compensating') return prev
  const anyFailed = Object.values(state.steps).some((r) => r.status === 'failed')
  if (prev === 'failed' && event.type !== 'step.invalidated') {
    // Halt: failed while ANY step record is failed; a retried step becomes active again and the
    // flow recovers. Nothing failed and nothing active = a terminal failure (compensated, loop).
    // v0.2: invalidating the failed step (§9.3) recovers too — it falls through to the general rule.
    if (anyFailed || state.active.length === 0) return 'failed'
  } else if (anyFailed && def.policies.onFailure === 'halt') {
    return 'failed'
  }
  let waiting = false
  for (const id of state.active) {
    const rec = state.steps[id]
    if (rec === undefined) continue
    switch (rec.kind) {
      case 'task':
      case 'decision':
      case 'final':
        return 'running'
      case 'flow':
        if (rec.child === undefined || rec.child.status !== 'waiting') return 'running'
        waiting = true
        break
      default:
        waiting = true
    }
  }
  if (waiting) return 'waiting'
  return state.startedAt !== null ? 'waiting' : 'idle'
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

function applyFlow(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'flow.started':
      return { ...state, startedAt: ev.at }
    case 'flow.done':
      return ev.output !== undefined ? { ...state, output: ev.output } : state
    case 'flow.failed':
      return state
    case 'flow.compensating': {
      const settling = state.active.filter((id) => runInFlight(state.steps[id]))
      const retried: ReadonlySet<string> = new Set(ev.plan)
      const saga: SagaState = {
        ...omit(state.saga, ['reason', 'outcome', 'inFlight']),
        failures: state.saga.failures.filter((f) => !retried.has(f.step)),
        settling,
        outcome: ev.outcome ?? 'failed',
        ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
      }
      return withSaga(state, saga)
    }
    case 'flow.compensated':
      return withSaga(state, omit(state.saga, ['settling', 'inFlight']))
    case 'flow.cancelled':
    case 'flow.resumed':
    case 'flow.status':
      return state
    case 'flow.reset':
      return initialState(env, {
        instanceId: state.instanceId,
        context: state.context,
        now: ev.at,
        epoch: state.epoch,
        ...(state.correlationId !== undefined ? { correlationId: state.correlationId } : {}),
      })
    default:
      return state
  }
}

function applyTransition(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'transition.started': {
      const auto = ev.cause === 'auto'
      const deferred = (state.nav.deferred ?? []).filter((d) => d.step !== ev.from)
      const nav: NavState = {
        phase: state.nav.phase,
        txId: ev.txId,
        from: ev.from,
        cause: ev.cause,
        direction: ev.cause === 'back' ? 'back' : 'forward',
        hops: auto ? (state.nav.hops ?? 0) + 1 : 0,
        ...(ev.to !== undefined ? { targets: [ev.to] } : {}),
        ...(deferred.length > 0 ? { deferred } : {}),
      }
      return withNav(state, nav)
    }
    case 'transition.phase': {
      const targets = ev.targets ?? state.nav.targets
      let pending: readonly string[] | undefined
      if (ev.phase === 'canEnter') {
        pending = (targets ?? []).filter((t) => env.def.steps[t]?.hooks.canEnter !== undefined)
      } else if (ev.phase === 'entering') {
        // Cursor-initiated transitions run `enter` for every target this commit will enter
        // (hook present, deps satisfied). Auto-advance from a non-view step leaves entry to
        // the scheduler's `entering` sub-phase.
        pending = cursorInitiated(env.def, state.nav)
          ? (targets ?? []).filter((t) => {
              const rec = state.steps[t]
              return (
                rec !== undefined &&
                env.def.steps[t]?.hooks.enter !== undefined &&
                (rec.status !== 'active' || t === state.nav.from) &&
                depsSatisfied(env.def, state, t)
              )
            })
          : []
      }
      const nav: NavState = {
        ...omit(state.nav, ['pendingSteps', 'targets']),
        phase: ev.phase,
        ...(targets !== undefined ? { targets } : {}),
        ...(pending !== undefined ? { pendingSteps: pending } : {}),
      }
      let next = withNav(state, nav)
      if (ev.phase === 'entering') {
        for (const t of pending ?? []) next = patchStep(next, t, { entering: true })
      }
      return next
    }
    case 'transition.committed': {
      const targets =
        state.nav.txId === ev.txId && state.nav.targets !== undefined ? state.nav.targets : [ev.to]
      const view = targets.find((t) => {
        const rec = state.steps[t]
        return rec !== undefined && rec.kind === 'view' && rec.status === 'active'
      })
      let history = state.history
      if (view !== undefined) {
        if (ev.direction === 'back') {
          const idx = history.lastIndexOf(view)
          history = idx >= 0 ? history.slice(0, idx + 1) : [...history, view]
        } else if (history[history.length - 1] !== view) {
          history = [...history, view]
        }
      }
      // v0.2: a cursor set forgets any hint; no cursor → remember the `when`-pending target (if any).
      const hint =
        view === undefined
          ? (pendingCursor(env.def, state, targets, ev.from) ?? state.nav.cursorHint)
          : undefined
      const nav = omit(idleNav(state.nav), ['cursorHint'])
      return {
        ...withNav(state, hint !== undefined ? { ...nav, cursorHint: hint } : nav),
        history,
        current: view ?? state.current,
      }
    }
    case 'transition.rejected':
    case 'transition.failed':
      return state.nav.txId === ev.txId || state.nav.txId === undefined
        ? withNav(clearEnterMarkers(state, state.nav.targets), idleNav(state.nav))
        : state
    default:
      return state
  }
}

function applyStep(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.arrived':
      return withStep(state, ev.step, (rec) => {
        if (rec.status === 'active' || rec.pendingActivation) return rec
        return { ...rec, pendingActivation: true, arrivedSeq: ev.seq }
      })
    case 'step.entered':
      return withStep(dropHint(state, ev.step), ev.step, (rec) => {
        const def = env.def.steps[ev.step]
        const seedInput =
          rec.kind === 'view' && rec.input === undefined && def?.initial !== undefined
            ? { input: def.initial }
            : {}
        const base = omit(rec, [
          'error',
          'issues',
          'output',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
          'exitedAt',
          'child',
          'entering',
          'enterDone',
          'when',
          'skipReason',
        ])
        return {
          ...base,
          ...seedInput,
          status: 'active',
          runId: ev.runId,
          attempt: 0,
          pendingActivation: false,
          enteredAt: ev.at,
          visitedCount: rec.visitedCount + 1,
          ...(ev.enterPending === true ? { entering: true } : {}),
        }
      })
    case 'step.enterCompleted': {
      // Transition `entering` phase: the target's hook resolved before commit → mark it so the
      // commit's `step.entered` skips the hook; scheduler entry: just leave the sub-phase.
      const inPhase =
        state.nav.phase === 'entering' && (state.nav.pendingSteps ?? []).includes(ev.step)
      let next = patchStep(state, ev.step, inPhase ? { enterDone: true } : {}, ['entering'])
      if (inPhase) {
        next = withNav(next, {
          ...next.nav,
          pendingSteps: (next.nav.pendingSteps ?? []).filter((s) => s !== ev.step),
        })
      }
      return next
    }
    case 'step.exited':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['entering']),
        status: ev.direction === 'back' ? 'idle' : 'done',
        pendingActivation: false,
        exitedAt: ev.at,
      }))
    case 'step.done': {
      const def = env.def.steps[ev.step]
      let next = withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['error', 'retryAt', 'deadline', 'entering', 'output']),
        status: 'done',
        pendingActivation: false,
        ...(ev.output !== undefined ? { output: ev.output } : {}),
      }))
      if (def?.hooks.compensate !== undefined) {
        const runId = state.steps[ev.step]?.runId ?? 0
        const entry = {
          step: ev.step,
          runId,
          seq: ev.seq,
          ...(ev.output !== undefined ? { output: ev.output } : {}),
        }
        next = withSaga(next, { ...next.saga, stack: [...state.saga.stack, entry] })
      }
      return def?.kind === 'view' ? next : deferContinuation(env.def, next, ev.step, ev.next)
    }
    case 'step.failed':
      return withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, ['retryAt', 'deadline', 'entering', 'when']),
        status: 'failed',
        pendingActivation: false,
        error: toStepError(
          ev.error,
          ev.kind,
          ev.at,
          rec.attempt > 0 ? rec.attempt : undefined,
          ev.data,
        ),
      }))
    case 'step.skipped': {
      // v0.2 (§9.2): done-without-running — no output, no error; the draft `input` and
      // `previousOutput` survive. Continues (auto-advance) once `nav` is idle when busy.
      const next = withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, [
          'entering',
          'when',
          'error',
          'issues',
          'output',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
        ]),
        status: 'skipped',
        pendingActivation: false,
        ...(ev.reason !== undefined ? { skipReason: ev.reason } : {}),
      }))
      return deferContinuation(env.def, next, ev.step, undefined)
    }
    case 'step.whenStarted':
      return patchStep(state, ev.step, { when: 'pending' })
    case 'step.whenEvaluated':
      return ev.ok
        ? patchStep(state, ev.step, { when: 'passed' })
        : patchStep(state, ev.step, {}, ['when'])
    case 'step.invalidated':
      // v0.2 (§9.3): back to idle; the output moves to `previousOutput`, a view keeps its draft.
      return withStep(dropHint(state, ev.step), ev.step, (rec) => ({
        ...omit(rec, [
          'output',
          'previousOutput',
          'error',
          'issues',
          'skipReason',
          'retryAt',
          'deadline',
          'idempotencyKey',
          'arrivedSeq',
          'entering',
          'enterDone',
          'when',
          'child',
        ]),
        status: 'idle',
        pendingActivation: false,
        ...(rec.output !== undefined ? { previousOutput: rec.output } : {}),
      }))
    case 'step.cancelled':
      return patchStep(state, ev.step, { status: 'cancelled', pendingActivation: false }, [
        'entering',
        'retryAt',
        'deadline',
        'when',
      ])
    case 'step.validated':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['issues']),
        ...(ev.output !== undefined ? { output: ev.output } : {}),
      }))
    case 'step.validationFailed':
      return patchStep(state, ev.step, { issues: ev.issues })
    case 'step.guardEvaluated': {
      const guard = {
        ok: ev.ok,
        seq: ev.seq,
        ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
      }
      let next = withStep(state, ev.step, (rec) => ({
        ...rec,
        guards: { ...rec.guards, [ev.hook]: guard },
      }))
      if (
        ev.hook === 'canEnter' &&
        ev.ok &&
        state.nav.phase === 'canEnter' &&
        state.nav.pendingSteps?.includes(ev.step)
      ) {
        next = withNav(next, {
          ...next.nav,
          pendingSteps: next.nav.pendingSteps?.filter((s) => s !== ev.step) ?? [],
        })
      }
      return next
    }
    default:
      return state
  }
}

function applyRun(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.runStarted':
      return withStep(state, ev.step, (rec) => ({
        ...omit(rec, ['retryAt', 'entering', ...(ev.attempt === 1 ? (['error'] as const) : [])]),
        status: 'active',
        attempt: ev.attempt,
        runId: ev.runId,
        idempotencyKey: ev.idempotencyKey,
      }))
    case 'step.runSucceeded':
      return settleRun(state, ev.step)
    case 'step.runFailed':
      return settleRun(
        withStep(state, ev.step, (rec) => ({
          ...rec,
          error: toStepError(
            ev.error,
            ev.timedOut === true ? 'timeout' : 'run',
            ev.at,
            ev.attempt,
            ev.data,
          ),
        })),
        ev.step,
      )
    case 'step.idempotencyKeyRequested':
    case 'step.mapErrorStarted':
      // Bookkeeping only: the in-flight call is identified by its token; nothing to store.
      return state
    case 'step.retryScheduled':
      return withTimer(patchStep(state, ev.step, { retryAt: ev.dueAt }), ev.timerId, {
        at: ev.dueAt,
        fire: { type: 'timer.fired', timerId: ev.timerId },
        purpose: 'retry',
        step: ev.step,
      })
    default:
      return state
  }
}

/** A run result arrived: the step is no longer part of compensation phase 1 (`saga.settling`). */
function settleRun(state: WizardState, step: string): WizardState {
  if (state.saga.settling === undefined || !state.saga.settling.includes(step)) return state
  return withSaga(state, { ...state.saga, settling: state.saga.settling.filter((s) => s !== step) })
}

function applySaga(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'step.compensationStarted': {
      const ref = { step: ev.step, runId: ev.runId ?? state.steps[ev.step]?.runId ?? 0 }
      return withSaga(patchStep(state, ev.step, { status: 'compensating' }), {
        ...state.saga,
        inFlight: ref,
      })
    }
    case 'step.compensated': {
      const ref = { step: ev.step, runId: ev.runId ?? state.saga.inFlight?.runId ?? 0 }
      return withSaga(patchStep(state, ev.step, { status: 'compensated' }), {
        ...omit(state.saga, ['inFlight']),
        compensated: state.saga.compensated.some((c) => sameEntry(c, ref))
          ? state.saga.compensated
          : [...state.saga.compensated, ref],
      })
    }
    case 'step.compensationFailed': {
      const ref = { step: ev.step, runId: ev.runId ?? state.saga.inFlight?.runId ?? 0 }
      return withSaga(
        withStep(state, ev.step, (rec) => ({
          ...rec,
          status: 'failed',
          error: toStepError(ev.error, 'compensate', ev.at),
        })),
        {
          ...omit(state.saga, ['inFlight']),
          failures: state.saga.failures.some((f) => sameEntry(f, ref))
            ? state.saga.failures
            : [...state.saga.failures, ref],
        },
      )
    }
    default:
      return state
  }
}

function applyData(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'input.changed':
      return withStep(state, ev.step, (rec) => {
        const base = omit(rec, ['issues', 'input'])
        if (ev.reset === true) {
          const initial = env.def.steps[ev.step]?.initial
          return initial !== undefined ? { ...base, input: initial } : base
        }
        if (isPlainObject(ev.patch)) {
          return { ...base, input: { ...(isPlainObject(rec.input) ? rec.input : {}), ...ev.patch } }
        }
        return ev.patch !== undefined ? { ...base, input: ev.patch } : base
      })
    case 'context.changed':
      if (!isPlainObject(ev.patch)) return state
      return {
        ...state,
        context: { ...(isPlainObject(state.context) ? state.context : {}), ...ev.patch },
      }
    default:
      return state
  }
}

function applyEvents(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'event.buffered': {
      const entry: InboxEntry = {
        id: ev.inboxId,
        event: ev.event,
        payload: ev.payload,
        at: ev.at,
        expiresAt: ev.expiresAt,
      }
      return { ...state, inbox: [...state.inbox, entry] }
    }
    case 'event.delivered':
    case 'event.expired':
      return withoutInbox(state, ev.inboxId)
    case 'event.received':
    case 'event.rejected':
    case 'event.dropped':
    case 'event.flowDelivered':
    case 'event.handlerResultIgnored':
    case 'event.handlerFailed':
      return state
    default:
      return state
  }
}

function clearTimerOwner(state: WizardState, entry: TimerEntry | undefined): WizardState {
  if (entry?.step === undefined) return state
  if (entry.purpose === 'retry') return patchStep(state, entry.step, {}, ['retryAt'])
  if (entry.purpose === 'waitTimeout') return patchStep(state, entry.step, {}, ['deadline'])
  return state
}

function applyTimers(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'timer.scheduled': {
      const entry: TimerEntry = {
        at: ev.dueAt,
        fire: { type: 'timer.fired', timerId: ev.timerId },
        purpose: ev.purpose,
        ...(ev.step !== undefined ? { step: ev.step } : {}),
      }
      let next = withTimer(state, ev.timerId, entry)
      if (ev.purpose === 'waitTimeout' && ev.step !== undefined)
        next = patchStep(next, ev.step, { deadline: ev.dueAt })
      return next
    }
    case 'timer.fired':
    case 'timer.cleared':
      return withoutTimer(clearTimerOwner(state, state.timers[ev.timerId]), ev.timerId)
    default:
      return state
  }
}

function applyChild(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'child.summary':
      return withStep(state, ev.step, (rec) => ({
        ...rec,
        child: ev.summary,
        ...(ev.done !== undefined ? { output: ev.done.output } : {}),
      }))
    case 'child.started':
    case 'child.command':
      return state
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function reduce(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'flow.started':
    case 'flow.done':
    case 'flow.failed':
    case 'flow.compensating':
    case 'flow.compensated':
    case 'flow.cancelled':
    case 'flow.resumed':
    case 'flow.reset':
    case 'flow.status':
      return applyFlow(env, state, ev)
    case 'transition.started':
    case 'transition.phase':
    case 'transition.committed':
    case 'transition.rejected':
    case 'transition.failed':
      return applyTransition(env, state, ev)
    case 'step.arrived':
    case 'step.entered':
    case 'step.enterCompleted':
    case 'step.exited':
    case 'step.done':
    case 'step.failed':
    case 'step.skipped':
    case 'step.whenStarted':
    case 'step.whenEvaluated':
    case 'step.invalidated':
    case 'step.cancelled':
    case 'step.validated':
    case 'step.validationFailed':
    case 'step.guardEvaluated':
      return applyStep(env, state, ev)
    case 'step.idempotencyKeyRequested':
    case 'step.runStarted':
    case 'step.runSucceeded':
    case 'step.mapErrorStarted':
    case 'step.runFailed':
    case 'step.retryScheduled':
      return applyRun(env, state, ev)
    case 'step.compensationStarted':
    case 'step.compensated':
    case 'step.compensationFailed':
      return applySaga(env, state, ev)
    case 'input.changed':
    case 'context.changed':
      return applyData(env, state, ev)
    case 'event.received':
    case 'event.rejected':
    case 'event.delivered':
    case 'event.buffered':
    case 'event.expired':
    case 'event.dropped':
    case 'event.flowDelivered':
    case 'event.handlerResultIgnored':
    case 'event.handlerFailed':
      return applyEvents(env, state, ev)
    case 'timer.scheduled':
    case 'timer.fired':
    case 'timer.cleared':
      return applyTimers(env, state, ev)
    case 'child.started':
    case 'child.summary':
    case 'child.command':
      return applyChild(env, state, ev)
    case 'command.rejected':
    case 'result.ignored':
    case 'persist.failed':
      return state
    default: {
      const _exhaustive: never = ev
      return _exhaustive
    }
  }
}

/**
 * Events that only an external message can produce (a command, a `send`, a
 * timer, a resume): they mark the boundary of an auto-advance chain, so the
 * `hops` counter restarts there (plan §8.3: "capped at 1000 hops per command").
 */
const HOP_RESET_EVENTS: ReadonlySet<DomainEvent['type']> = new Set([
  'flow.started',
  'flow.resumed',
  'event.received',
  'event.rejected',
  'input.changed',
  'timer.fired',
  'command.rejected',
])

function resetHops(state: WizardState, event: DomainEvent): WizardState {
  if (!HOP_RESET_EVENTS.has(event.type) || (state.nav.hops ?? 0) === 0) return state
  return withNav(state, { ...state.nav, hops: 0 })
}

export function apply(env: MachineEnv, state: WizardState, event: DomainEvent): WizardState {
  const reduced = resetHops(reduce(env, state, event), event)
  if (event.type === 'flow.reset') {
    return { ...reduced, seq: event.seq, updatedAt: event.at }
  }
  const active = Object.keys(reduced.steps).filter((id) => reduced.steps[id]?.status === 'active')
  // Keep activation order stable: previously active ids first (in their order), then newcomers.
  const ordered = [
    ...reduced.active.filter((id) => active.includes(id)),
    ...active.filter((id) => !reduced.active.includes(id)),
  ]
  const current =
    reduced.current !== null && reduced.steps[reduced.current]?.status === 'active'
      ? reduced.current
      : null
  const withActive: WizardState = { ...reduced, active: ordered, current }
  return {
    ...withActive,
    status: deriveStatus(env.def, withActive, event),
    seq: event.seq,
    updatedAt: event.at,
  }
}
