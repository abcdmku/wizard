/**
 * Reducers for the navigation-transaction events (`transition.*`).
 * @internal
 */

import type { CompiledWizard } from '../../authoring/compiled'
import type { DomainEvent } from '../events'
import { awaitingWhen, cursorInitiated, depsSatisfied, isExplicitCause } from '../selectors'
import type { NavState, WizardState } from '../state'
import type { MachineEnv } from '../types'
import { omit } from '../util'
import { patchStep, withNav } from './patch'

/** How many auto-advance sources `nav.trail` keeps. */
const TRAIL = 4

/** Idle nav that keeps the cross-transaction bookkeeping (`hops`, `trail`, `deferred`, `cursorHint`). */
function idleNav(nav: NavState): NavState {
  const out: NavState = { phase: 'idle' }
  return {
    ...out,
    ...(nav.hops !== undefined ? { hops: nav.hops } : {}),
    ...(nav.trail !== undefined ? { trail: nav.trail } : {}),
    ...(nav.deferred !== undefined && nav.deferred.length > 0 ? { deferred: nav.deferred } : {}),
    ...(nav.cursorHint !== undefined ? { cursorHint: nav.cursorHint } : {}),
  }
}

/**
 * A completed transition could not enter its cursor target because the target's `when`
 * predicate is unresolved → remember it so the cursor rule prefers it once the predicate passes.
 * Same admission rule as `cursorTarget` (a background auto-advance never steals the cursor).
 */
function pendingCursor(
  def: CompiledWizard,
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

/** Clear transient entry markers on the targets of a transaction that did not commit. */
function clearEnterMarkers(
  state: WizardState,
  targets: readonly string[] | undefined,
): WizardState {
  let next = state
  for (const t of targets ?? []) {
    const rec = next.steps[t]
    if (rec?.entering === true || rec?.enterDone === true || rec?.initializing !== undefined) {
      next = patchStep(next, t, {}, ['entering', 'enterDone', 'initializing'])
    }
  }
  return next
}

export function applyTransition(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'transition.started': {
      const auto = ev.cause === 'auto'
      const hops = auto ? (ev.hops ?? (state.nav.hops ?? 0) + 1) : 0
      const trail =
        auto && ev.from !== null
          ? [...(hops > 1 ? (state.nav.trail ?? []) : []), ev.from].slice(-TRAIL)
          : undefined
      const deferred = (state.nav.deferred ?? []).filter((d) => d.step !== ev.from)
      const nav: NavState = {
        phase: state.nav.phase,
        txId: ev.txId,
        from: ev.from,
        cause: ev.cause,
        direction: ev.cause === 'back' ? 'back' : 'forward',
        hops,
        ...(trail !== undefined ? { trail } : {}),
        ...(ev.to !== undefined ? { targets: [ev.to] } : {}),
        ...(deferred.length > 0 ? { deferred } : {}),
        // The hint survives unrelated transactions; only a cursor set (or the hinted
        // view entering / skipping / invalidating / failing) forgets it.
        ...(state.nav.cursorHint !== undefined ? { cursorHint: state.nav.cursorHint } : {}),
      }
      // Explicit navigation (`go` / `back`) to a view bypasses its `when` — an in-flight
      // predicate is staled now (its late result is `result.ignored`) so it cannot skip the
      // target while the transaction runs.
      const to = ev.to
      const bypassed =
        to !== undefined && isExplicitCause(ev.cause) && state.steps[to]?.when === 'pending'
      const next = withNav(state, nav)
      return bypassed ? patchStep(next, to, {}, ['when']) : next
    }
    case 'transition.phase': {
      const targets = ev.targets ?? state.nav.targets
      let pending: readonly string[] | undefined
      let initializing: readonly string[] = []
      if (ev.phase === 'canEnter') {
        pending = (targets ?? []).filter((t) => env.def.steps[t]?.hooks.canEnter !== undefined)
      } else if (ev.phase === 'entering') {
        // The first pass initializes missing dynamic view drafts. Once they resolve, a second
        // `entering` phase runs target `enter` hooks. Non-cursor auto-advance leaves both stages
        // to the scheduler after commit.
        const explicit = isExplicitCause(state.nav.cause)
        const candidates = cursorInitiated(env.def, state.nav)
          ? (targets ?? []).filter((t) => {
              const rec = state.steps[t]
              return (
                rec !== undefined &&
                (rec.status !== 'active' || t === state.nav.from) &&
                depsSatisfied(env.def, state, t) &&
                (explicit || !awaitingWhen(env.def, state, t))
              )
            })
          : []
        initializing = candidates.filter((t) => {
          const rec = state.steps[t]
          const def = env.def.steps[t]
          return def?.kind === 'view' && def.hooks.initial !== undefined && rec?.input === undefined
        })
        pending =
          initializing.length > 0
            ? initializing
            : candidates.filter((t) => env.def.steps[t]?.hooks.enter !== undefined)
      }
      const nav: NavState = {
        ...omit(state.nav, ['pendingSteps', 'targets']),
        phase: ev.phase,
        ...(targets !== undefined ? { targets } : {}),
        ...(pending !== undefined ? { pendingSteps: pending } : {}),
      }
      let next = withNav(state, nav)
      if (ev.phase === 'entering') {
        const init = new Set(initializing)
        for (const t of pending ?? []) {
          const rec = next.steps[t]
          next = init.has(t)
            ? patchStep(next, t, { initializing: rec?.initializing ?? ev.seq })
            : patchStep(next, t, { entering: true })
        }
      }
      return next
    }
    case 'transition.committed': {
      const targets =
        state.nav.txId === ev.txId && state.nav.targets !== undefined
          ? state.nav.targets
          : ev.to === null
            ? []
            : [ev.to]
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
      // A cursor set forgets any hint; no cursor → remember the `when`-pending target (if any).
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
    case 'transition.rejected': {
      if (state.nav.txId !== ev.txId && state.nav.txId !== undefined) return state
      const saved = state.nav
      const nav = idleNav(saved)
      const from = saved.from
      const source = from == null ? undefined : state.steps[from]
      const recover =
        ev.reason === 'resumed' &&
        saved.cause === 'auto' &&
        saved.phase !== 'idle' &&
        from != null &&
        source?.kind !== 'view' &&
        (source?.status === 'done' || source?.status === 'skipped')
      const deferred =
        recover && from != null
          ? [
              { step: from, ...(saved.targets !== undefined ? { to: saved.targets } : {}) },
              ...(nav.deferred ?? []).filter((entry) => entry.step !== from),
            ]
          : nav.deferred
      return withNav(clearEnterMarkers(state, saved.targets), {
        ...nav,
        ...(deferred !== undefined ? { deferred } : {}),
      })
    }
    case 'transition.failed':
      return state.nav.txId === ev.txId || state.nav.txId === undefined
        ? withNav(clearEnterMarkers(state, state.nav.targets), idleNav(state.nav))
        : state
    default:
      return state
  }
}
