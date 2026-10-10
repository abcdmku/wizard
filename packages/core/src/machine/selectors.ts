/**
 * Selectors — pure derived values over `WizardState`.
 *
 * Nothing here is stored and nothing here calls a hook. Results are memoized
 * per state object (states are immutable, so a `WeakMap` keyed by the state is
 * equivalent to "memoized per `state.seq`") — repeated UI reads are free.
 *
 * `decide` uses `depsSatisfied` / `ready` / `readySteps` / `cursorTarget`;
 * `explain` and the façade use the rest.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { NavCause, NavState, SagaEntryRef, StepRecord, WizardState } from './state'

/** UI-facing live phase of a step (undefined when the step has no live phase: idle/done/failed/…). */
export type StepPhase =
  | 'blocked'
  | 'ready'
  | 'entering'
  | 'validating'
  | 'running'
  | 'retrying'
  | 'waiting'
  | 'exiting'
  | 'compensating'

// ---------------------------------------------------------------------------
// Memo (per state object)
// ---------------------------------------------------------------------------

interface Memo {
  readySteps?: readonly string[]
  eligibleSteps?: readonly string[]
  readyOrCurrentViews?: readonly string[]
  progress?: Progress
  readonly deps: Map<string, boolean>
  readonly phase: Map<string, StepPhase | undefined>
}

/** v0.2 (§9.6): completion counters over the non-final steps; `skipped` counts as done. */
export interface Progress {
  readonly done: number
  readonly total: number
  /** `done / total` (0 when there is nothing to count); 1 once the flow is `done`. */
  readonly ratio: number
}

const memos = new WeakMap<WizardState, Memo>()

function memo(state: WizardState): Memo {
  let m = memos.get(state)
  if (m === undefined) {
    m = { deps: new Map(), phase: new Map() }
    memos.set(state, m)
  }
  return m
}

// ---------------------------------------------------------------------------
// Readiness (§3.1)
// ---------------------------------------------------------------------------

function isComplete(rec: StepRecord | undefined): boolean {
  return rec !== undefined && (rec.status === 'done' || rec.status === 'skipped')
}

/** `depsSatisfied(id) = !dependsOn || (all: every dep done|skipped) || (any: some dep done|skipped)`. */
export function depsSatisfied(def: CompiledFlow, state: WizardState, id: string): boolean {
  const m = memo(state)
  const cached = m.deps.get(id)
  if (cached !== undefined) return cached
  const deps = def.steps[id]?.dependsOn
  let ok = true
  if (deps !== undefined) {
    if ('all' in deps) ok = deps.all.every((d) => isComplete(state.steps[d]))
    else ok = deps.any.some((d) => isComplete(state.steps[d]))
  }
  m.deps.set(id, ok)
  return ok
}

/** Ids of unmet dependencies (for `explain`). */
export function unmetDeps(def: CompiledFlow, state: WizardState, id: string): readonly string[] {
  const deps = def.steps[id]?.dependsOn
  if (deps === undefined) return []
  const list = 'all' in deps ? deps.all : deps.any
  const unmet = list.filter((d) => !isComplete(state.steps[d]))
  if ('any' in deps && unmet.length < list.length) return []
  return unmet
}

/**
 * v0.2: the step declares a `when` predicate that has not passed for the current activation
 * (unevaluated, or in flight). Such a step is eligible but not ready: the scheduler evaluates
 * `when` first and either lets it enter (`'passed'`) or skips it.
 */
export function awaitingWhen(def: CompiledFlow, state: WizardState, id: string): boolean {
  return def.steps[id]?.hooks.when !== undefined && state.steps[id]?.when !== 'passed'
}

/** Activated + gated, ignoring `when`: `pendingActivation && status !== 'active' && depsSatisfied(id)` (§3.1). */
export function eligible(def: CompiledFlow, state: WizardState, id: string): boolean {
  const rec = state.steps[id]
  if (rec === undefined) return false
  return rec.pendingActivation && rec.status !== 'active' && depsSatisfied(def, state, id)
}

/** `ready(id) = eligible(id) && !awaitingWhen(id)` — may enter now (v0.2 adds the `when` clause). */
export function ready(def: CompiledFlow, state: WizardState, id: string): boolean {
  return eligible(def, state, id) && !awaitingWhen(def, state, id)
}

function byArrival(state: WizardState, ids: readonly string[]): readonly string[] {
  return [...ids].sort(
    (a, b) => (state.steps[a]?.arrivedSeq ?? 0) - (state.steps[b]?.arrivedSeq ?? 0),
  )
}

/** Eligible steps (ready ignoring `when`) in ascending `arrivedSeq` order. */
export function eligibleSteps(def: CompiledFlow, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.eligibleSteps !== undefined) return m.eligibleSteps
  const list = byArrival(
    state,
    def.order.filter((id) => eligible(def, state, id)),
  )
  m.eligibleSteps = list
  return list
}

/** Ready steps in ascending `arrivedSeq` order (the scheduler's candidate list). */
export function readySteps(def: CompiledFlow, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.readySteps !== undefined) return m.readySteps
  const list = eligibleSteps(def, state).filter((id) => !awaitingWhen(def, state, id))
  m.readySteps = list
  return list
}

/** Ready views (cursor-rule candidates), in arrival order. */
export function readyViews(def: CompiledFlow, state: WizardState): readonly string[] {
  return readySteps(def, state).filter((id) => def.steps[id]?.kind === 'view')
}

/** Eligible views whose `when` is still unresolved: the cursor rule waits for them (v0.2). */
export function viewsAwaitingWhen(def: CompiledFlow, state: WizardState): readonly string[] {
  return eligibleSteps(def, state).filter(
    (id) => def.steps[id]?.kind === 'view' && awaitingWhen(def, state, id),
  )
}

/** Number of tasks currently active (concurrency budget consumer). */
export function activeTaskCount(def: CompiledFlow, state: WizardState): number {
  let n = 0
  for (const id of state.active) if (def.steps[id]?.kind === 'task') n++
  return n
}

/**
 * The view among `targets` (in order) that a committing transition makes current:
 * the first view whose deps are satisfied and that is not active elsewhere
 * (`from` itself is allowed: `next: 'self'` loops). `undefined` = no cursor target.
 */
export function cursorTarget(
  def: CompiledFlow,
  state: WizardState,
  targets: readonly string[],
  from: string | null | undefined,
): string | undefined {
  // Only a transition that leaves the current view (or starts with no cursor)
  // moves the cursor; a background auto-advance never steals it — its view
  // targets stay ready (reachable via `go`, picked up by the cursor rule later).
  if (state.current !== null && from !== state.current) return undefined
  return targets.find((t) => {
    const rec = state.steps[t]
    if (rec === undefined || rec.kind !== 'view') return false
    if (rec.status === 'active' && t !== from) return false
    return depsSatisfied(def, state, t)
  })
}

// ---------------------------------------------------------------------------
// Flow-level helpers
// ---------------------------------------------------------------------------

/**
 * Halt-failure that `retry(step)` can recover from: status 'failed', the flow never
 * compensated (`saga.outcome` unset) and at least one step record is still failed.
 */
export function isRecoverableFailure(state: WizardState): boolean {
  return (
    state.status === 'failed' &&
    state.saga.outcome === undefined &&
    Object.values(state.steps).some((r) => r.status === 'failed')
  )
}

/** A transition initiated by the cursor (user `next/go/back`, cursor rule): `from` is a view or null. */
export function cursorInitiated(def: CompiledFlow, nav: NavState): boolean {
  return nav.from == null || def.steps[nav.from]?.kind === 'view'
}

/** Explicit navigation (`go` / `back`): the user's intent overrides the target's `when` (v0.2). */
export function isExplicitCause(cause: NavCause | undefined): boolean {
  return cause === 'go' || cause === 'back'
}

/** `step` is the target of an in-flight explicit transaction — its `when` is bypassed for it. */
export function explicitTarget(state: WizardState, step: string): boolean {
  const nav = state.nav
  return nav.phase !== 'idle' && isExplicitCause(nav.cause) && (nav.targets ?? []).includes(step)
}

export function sameEntry(a: SagaEntryRef, b: SagaEntryRef): boolean {
  return a.step === b.step && a.runId === b.runId
}

/** Terminal = done | cancelled | non-recoverable failed. */
export function isTerminal(state: WizardState): boolean {
  if (state.status === 'done' || state.status === 'cancelled') return true
  return state.status === 'failed' && !isRecoverableFailure(state)
}

/** True while a task's `run` effect is in flight (result still expected). */
export function runInFlight(rec: StepRecord | undefined): boolean {
  return (
    rec !== undefined &&
    rec.kind === 'task' &&
    rec.status === 'active' &&
    rec.attempt >= 1 &&
    rec.retryAt === undefined &&
    rec.entering !== true
  )
}

// ---------------------------------------------------------------------------
// UI-facing derived axes
// ---------------------------------------------------------------------------

const EXIT_PHASES: ReadonlySet<string> = new Set([
  'canExit',
  'resolvingTarget',
  'canEnter',
  'exiting',
  'entering',
])

export function phase(def: CompiledFlow, state: WizardState, id: string): StepPhase | undefined {
  const m = memo(state)
  if (m.phase.has(id)) return m.phase.get(id)
  const p = computePhase(def, state, id)
  m.phase.set(id, p)
  return p
}

function computePhase(def: CompiledFlow, state: WizardState, id: string): StepPhase | undefined {
  const rec = state.steps[id]
  if (rec === undefined) return undefined
  if (rec.status === 'compensating') return 'compensating'
  if (rec.status !== 'active') {
    if (!rec.pendingActivation) return undefined
    // v0.2: an eligible step whose `when` predicate is unresolved cannot enter yet → blocked.
    return depsSatisfied(def, state, id) && !awaitingWhen(def, state, id) ? 'ready' : 'blocked'
  }
  if (rec.entering === true) return 'entering'
  switch (rec.kind) {
    case 'view': {
      if (state.nav.from === id && state.nav.phase !== 'idle') {
        if (state.nav.phase === 'parsingInput' || state.nav.phase === 'validating')
          return 'validating'
        if (EXIT_PHASES.has(state.nav.phase)) return 'exiting'
      }
      return 'waiting'
    }
    case 'task':
      return rec.retryAt !== undefined ? 'retrying' : 'running'
    case 'wait':
      return 'waiting'
    case 'flow':
      return rec.child?.status === 'waiting' ? 'waiting' : 'running'
    default:
      return 'running'
  }
}

/** A view the user can `go` to right now: ready or previously visited (`visitedCount > 0`), and not the current one. */
export function available(def: CompiledFlow, state: WizardState, id: string): boolean {
  const rec = state.steps[id]
  if (rec === undefined || rec.kind !== 'view' || id === state.current) return false
  return ready(def, state, id) || rec.visitedCount > 0
}

/**
 * v0.2 (§9.6): `{ done, total, ratio }` over the non-final steps (`done` = status `done` or
 * `skipped`); `ratio` is 1 once the flow is `done` (branches never taken do not count against a
 * finished flow). Memoized per state. `ChildSummary.progress` and `ClientState.progress` use it.
 */
export function progress(state: WizardState, def: CompiledFlow): Progress {
  const m = memo(state)
  if (m.progress !== undefined) return m.progress
  let done = 0
  let total = 0
  for (const id of def.order) {
    const rec = state.steps[id]
    if (rec === undefined || (def.steps[id]?.kind ?? rec.kind) === 'final') continue
    total += 1
    if (rec.status === 'done' || rec.status === 'skipped') done += 1
  }
  const ratio = state.status === 'done' ? 1 : total === 0 ? 0 : done / total
  const p: Progress = { done, total, ratio }
  m.progress = p
  return p
}

/**
 * v0.2 (§9.6): views the user can be on right now — the current view plus every ready view, in
 * declaration order. Memoized per state (one array identity per seq).
 */
export function readyOrCurrentViews(def: CompiledFlow, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.readyOrCurrentViews !== undefined) return m.readyOrCurrentViews
  const list = def.order.filter(
    (id) => def.steps[id]?.kind === 'view' && (id === state.current || ready(def, state, id)),
  )
  m.readyOrCurrentViews = list
  return list
}
