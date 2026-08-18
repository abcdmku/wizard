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
import type { NavState, SagaEntryRef, StepRecord, WizardState } from './state'

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
  progress?: number
  readonly deps: Map<string, boolean>
  readonly phase: Map<string, StepPhase | undefined>
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

/** `ready(id) = pendingActivation && status !== 'active' && depsSatisfied(id)`. */
export function ready(def: CompiledFlow, state: WizardState, id: string): boolean {
  const rec = state.steps[id]
  if (rec === undefined) return false
  return rec.pendingActivation && rec.status !== 'active' && depsSatisfied(def, state, id)
}

/** Ready steps in ascending `arrivedSeq` order (the scheduler's candidate list). */
export function readySteps(def: CompiledFlow, state: WizardState): readonly string[] {
  const m = memo(state)
  if (m.readySteps !== undefined) return m.readySteps
  const list = def.order
    .filter((id) => ready(def, state, id))
    .sort((a, b) => (state.steps[a]?.arrivedSeq ?? 0) - (state.steps[b]?.arrivedSeq ?? 0))
  m.readySteps = list
  return list
}

/** Ready views (cursor-rule candidates), in arrival order. */
export function readyViews(def: CompiledFlow, state: WizardState): readonly string[] {
  return readySteps(def, state).filter((id) => def.steps[id]?.kind === 'view')
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

export function sameEntry(a: SagaEntryRef, b: SagaEntryRef): boolean {
  return a.step === b.step && a.runId === b.runId
}

/** Terminal = done | cancelled | non-recoverable failed. */
export function isTerminal(state: WizardState): boolean {
  if (state.status === 'done' || state.status === 'cancelled') return true
  return state.status === 'failed' && !isRecoverableFailure(state)
}

export function isNavBusy(state: WizardState): boolean {
  return state.nav.phase !== 'idle'
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
    return depsSatisfied(def, state, id) ? 'ready' : 'blocked'
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

export function visited(state: WizardState, id: string): boolean {
  return (state.steps[id]?.visitedCount ?? 0) > 0
}

export function complete(state: WizardState, id: string): boolean {
  return isComplete(state.steps[id])
}

/** Fraction of steps that are done|skipped|compensated (0..1). */
export function progress(state: WizardState): number {
  const m = memo(state)
  if (m.progress !== undefined) return m.progress
  const ids = Object.keys(state.steps)
  const finished = ids.filter((id) => {
    const s = state.steps[id]?.status
    return s === 'done' || s === 'skipped' || s === 'compensated'
  }).length
  const p = ids.length === 0 ? 0 : finished / ids.length
  m.progress = p
  return p
}

/** Buffered inbox entries whose TTL has passed. */
export function expiredInbox(state: WizardState, now: number): readonly string[] {
  return state.inbox.filter((e) => e.expiresAt <= now).map((e) => e.id)
}
