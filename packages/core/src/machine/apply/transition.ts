/**
 * Reducers for the navigation-transaction events (`transition.*`).
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import type { DomainEvent } from '../events'
import { awaitingWhen, cursorInitiated, depsSatisfied, isExplicitCause } from '../selectors'
import type { NavState, WizardState } from '../state'
import type { MachineEnv } from '../types'
import { omit } from '../util'
import { patchStep, withNav } from './patch'

/** Idle nav that keeps the cross-transaction bookkeeping (`hops`, `deferred`, `cursorHint`). */
export function idleNav(nav: NavState): NavState {
  const out: NavState = { phase: 'idle' }
  return {
    ...out,
    ...(nav.hops !== undefined ? { hops: nav.hops } : {}),
    ...(nav.deferred !== undefined && nav.deferred.length > 0 ? { deferred: nav.deferred } : {}),
    ...(nav.cursorHint !== undefined ? { cursorHint: nav.cursorHint } : {}),
  }
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

export function applyTransition(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
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
        // v0.2 (§10.2): the hint survives unrelated transactions; only a cursor set (or the hinted
        // view entering / skipping / invalidating / failing) forgets it.
        ...(state.nav.cursorHint !== undefined ? { cursorHint: state.nav.cursorHint } : {}),
      }
      // v0.2: explicit navigation (`go` / `back`) to a view bypasses its `when` — an in-flight
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
      if (ev.phase === 'canEnter') {
        pending = (targets ?? []).filter((t) => env.def.steps[t]?.hooks.canEnter !== undefined)
      } else if (ev.phase === 'entering') {
        // Cursor-initiated transitions run `enter` for every target this commit will enter
        // (hook present, deps satisfied, and — unless the navigation is explicit — its `when`
        // passed: `when` runs before `enter`). Auto-advance from a non-view step leaves entry
        // to the scheduler's `entering` sub-phase.
        const explicit = isExplicitCause(state.nav.cause)
        pending = cursorInitiated(env.def, state.nav)
          ? (targets ?? []).filter((t) => {
              const rec = state.steps[t]
              return (
                rec !== undefined &&
                env.def.steps[t]?.hooks.enter !== undefined &&
                (rec.status !== 'active' || t === state.nav.from) &&
                depsSatisfied(env.def, state, t) &&
                (explicit || !awaitingWhen(env.def, state, t))
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
