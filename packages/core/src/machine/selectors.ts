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

import type { CompiledStep, CompiledWizard } from '../authoring/compiled'
import { childActivity } from './child-activity'
import { needsSatisfied } from './needs'
import type { NavCause, NavState, SagaEntryRef, StepRecord, WizardState } from './state'
import { stepIndex } from './step-index'

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

/** Completion counters over all steps; `skipped` counts as done. */
export interface Progress {
  readonly done: number
  readonly total: number
  /** `done / total` (0 when there is nothing to count); 1 once the run is `done`. */
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
// Readiness
// ---------------------------------------------------------------------------

export function isRunnableStep(def: CompiledStep | undefined): def is CompiledStep & {
  readonly kind: 'step'
  readonly hooks: CompiledStep['hooks'] & {
    readonly run: NonNullable<CompiledStep['hooks']['run']>
  }
} {
  return def?.kind === 'step' && def.hooks.run !== undefined
}

export function isEventStep(def: CompiledStep | undefined): def is CompiledStep & {
  readonly hooks: CompiledStep['hooks'] & {
    readonly waitFor: NonNullable<CompiledStep['hooks']['waitFor']>
  }
} {
  return def?.hooks.waitFor !== undefined
}

export function isRoutingStep(
  def: CompiledStep | undefined,
): def is CompiledStep & { readonly kind: 'step' } {
  return (
    def?.kind === 'step' &&
    def.hooks.run === undefined &&
    def.hooks.waitFor === undefined &&
    def.sleep === undefined &&
    def.each === undefined &&
    def.next.kind === 'dynamic'
  )
}

/** The step's needs are met: every producer has an output, or an optional one settled. */
export function depsSatisfied(def: CompiledWizard, state: WizardState, id: string): boolean {
  const m = memo(state)
  const cached = m.deps.get(id)
  if (cached !== undefined) return cached
  const ok = needsSatisfied(def, state, id)
  m.deps.set(id, ok)
  return ok
}

/**
 * The step declares a `when` predicate that has not passed for the current activation
 * (unevaluated, or in flight). Such a step is eligible but not ready: the scheduler evaluates
 * `when` first and either lets it enter (`'passed'`) or skips it.
 */
export function awaitingWhen(def: CompiledWizard, state: WizardState, id: string): boolean {
  return def.steps[id]?.hooks.when !== undefined && state.steps[id]?.when !== 'passed'
}

/** Activated + gated, ignoring `when`: `pendingActivation && status !== 'active' && depsSatisfied(id)`. */
export function eligible(def: CompiledWizard, state: WizardState, id: string): boolean {
  const rec = state.steps[id]
  if (rec === undefined) return false
  return rec.pendingActivation && rec.status !== 'active' && depsSatisfied(def, state, id)
}

/** `ready(id) = eligible(id) && !awaitingWhen(id)` — may enter now. */
export function ready(def: CompiledWizard, state: WizardState, id: string): boolean {
  return eligible(def, state, id) && !awaitingWhen(def, state, id)
}

/** Eligible steps (ready ignoring `when`) in ascending `arrivedSeq` order. */
export function eligibleSteps(def: CompiledWizard, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.eligibleSteps !== undefined) return m.eligibleSteps
  const list = stepIndex(state.steps).pending.filter((id) => eligible(def, state, id))
  m.eligibleSteps = list
  return list
}

/** Ready steps in ascending `arrivedSeq` order (the scheduler's candidate list). */
export function readySteps(def: CompiledWizard, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.readySteps !== undefined) return m.readySteps
  const list = eligibleSteps(def, state).filter((id) => !awaitingWhen(def, state, id))
  m.readySteps = list
  return list
}

/** Ready views (cursor-rule candidates), in arrival order. */
export function readyViews(def: CompiledWizard, state: WizardState): readonly string[] {
  return readySteps(def, state).filter((id) => def.steps[id]?.kind === 'view')
}

/** Eligible views whose `when` is still unresolved: the cursor rule waits for them. */
export function viewsAwaitingWhen(def: CompiledWizard, state: WizardState): readonly string[] {
  return eligibleSteps(def, state).filter(
    (id) => def.steps[id]?.kind === 'view' && awaitingWhen(def, state, id),
  )
}

/** Number of active run effects consuming the concurrency budget. */
export function activeRunCount(def: CompiledWizard, state: WizardState): number {
  let n = 0
  for (const id of state.active) if (isRunnableStep(def.steps[id])) n++
  return n
}

/**
 * The view among `targets` (in order) that a committing transition makes current:
 * the first view whose deps are satisfied and that is not active elsewhere
 * (`from` itself is allowed: `next: 'self'` loops). `undefined` = no cursor target.
 */
export function cursorTarget(
  def: CompiledWizard,
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
// Wizard-level helpers
// ---------------------------------------------------------------------------

/** A transition initiated by the cursor (user `next/go/back`, cursor rule): `from` is a view or null. */
export function cursorInitiated(def: CompiledWizard, nav: NavState): boolean {
  return nav.from == null || def.steps[nav.from]?.kind === 'view'
}

/** Explicit navigation (`go` / `back`): the user's intent overrides the target's `when`. */
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

/** Terminal = done | cancelled | failed (a recoverable failure is `halted`). */
export function isTerminal(state: WizardState): boolean {
  return state.status === 'done' || state.status === 'cancelled' || state.status === 'failed'
}

/** True while a step's `run` effect is in flight. */
export function runInFlight(rec: StepRecord | undefined): boolean {
  return (
    rec !== undefined &&
    rec.kind === 'step' &&
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

export function phase(def: CompiledWizard, state: WizardState, id: string): StepPhase | undefined {
  const m = memo(state)
  if (m.phase.has(id)) return m.phase.get(id)
  const p = computePhase(def, state, id)
  m.phase.set(id, p)
  return p
}

function computePhase(def: CompiledWizard, state: WizardState, id: string): StepPhase | undefined {
  const rec = state.steps[id]
  if (rec === undefined) return undefined
  if (rec.status === 'compensating') return 'compensating'
  if (rec.status !== 'active') {
    if (!rec.pendingActivation) return undefined
    // An eligible step whose `when` predicate is unresolved cannot enter yet → blocked.
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
    case 'step':
      return isEventStep(def.steps[id]) || def.steps[id]?.sleep !== undefined
        ? 'waiting'
        : rec.retryAt !== undefined
          ? 'retrying'
          : 'running'
    case 'child':
      return childActivity(rec) === 'waiting' ? 'waiting' : 'running'
    default:
      return 'running'
  }
}

/** A view the user can `go` to right now: ready or previously visited (`visitedCount > 0`), and not the current one. */
export function available(def: CompiledWizard, state: WizardState, id: string): boolean {
  const rec = state.steps[id]
  if (rec === undefined || rec.kind !== 'view' || id === state.current) return false
  return ready(def, state, id) || rec.visitedCount > 0
}

/**
 * `{ done, total, ratio }` over all steps (`done` = status `done` or
 * `skipped`). Once the run is `done`, branches never taken drop out: `total = done`, `ratio = 1`.
 * Memoized per state. `ChildSummary.progress` and `ClientState.progress` use it.
 */
export function progress(state: WizardState, def: CompiledWizard): Progress {
  const m = memo(state)
  if (m.progress !== undefined) return m.progress
  const done = stepIndex(state.steps).completed
  let total = def.order.length
  if (state.status === 'done') total = done
  const p: Progress = { done, total, ratio: total === 0 ? 0 : done / total }
  m.progress = p
  return p
}

/**
 * Views the user can be on right now — the current view plus every ready view, in
 * declaration order. Memoized per state (one array identity per seq).
 */
export function readyOrCurrentViews(def: CompiledWizard, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.readyOrCurrentViews !== undefined) return m.readyOrCurrentViews
  const order = declarationOrder(def)
  const candidates = readyViews(def, state).filter((id) => id !== state.current)
  if (state.current !== null) candidates.push(state.current)
  const list = candidates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  m.readyOrCurrentViews = list
  return list
}

// ---------------------------------------------------------------------------
// Per-definition facts (memoized per compiled wizard)
// ---------------------------------------------------------------------------

interface DefFacts {
  readonly order: ReadonlyMap<string, number>
}

const defFacts = new WeakMap<CompiledWizard, DefFacts>()

function facts(def: CompiledWizard): DefFacts {
  let f = defFacts.get(def)
  if (f === undefined) {
    f = {
      order: new Map(def.order.map((id, i) => [id, i])),
    }
    defFacts.set(def, f)
  }
  return f
}

/** Step id -> declaration index. */
function declarationOrder(def: CompiledWizard): ReadonlyMap<string, number> {
  return facts(def).order
}
