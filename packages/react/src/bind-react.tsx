/**
 * `bindReact<T>()` — tRPC-style binding: the flow/projection is a TYPE parameter (a type-only
 * import on the client), the live instance is supplied through `Provider`. Returns a `Provider`
 * and hooks typed by `T`, all built on `useSyncExternalStore` over the source's own
 * `subscribe`/`getSnapshot` (Wizard) or `subscribe`/`getSnapshot` (Mirror): snapshot identities
 * are stable per commit/frame, so `useStep`/`useSelector` re-render only when their slice
 * changes. Action objects are memoised per source (stable identities for effects and memo).
 *
 * Server rendering: `Provider` accepts a `serverSnapshot` (captured once); it is what every hook
 * returns as `useSyncExternalStore`'s server snapshot — on the server and during hydration —
 * so the hydrated tree matches the server HTML even when the live source already moved on.
 *
 * Child flows (v0.2): `useChild(step)` returns hooks bound to the child slice — over a Mirror the
 * `steps[step].child` slice of the projected state (exposed with `child: ExposeSpec`), over a
 * Wizard `getSnapshot().children[step].state` — and a scoped `MirrorChild`-shaped action set
 * (every command wrapped as `{ type: 'child', path, command }` through the source's `dispatch`).
 * Child bindings are memoised per (binding, path) so their hooks have stable identities.
 *
 * @packageDocumentation
 */

import type { AnyProjection, ChildFlowOf, StepId } from '@openwizard/core'
import {
  createContext,
  Fragment,
  type ReactElement,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { adapt, type Bound, type RawActions, type RawState } from './adapter'
import { childActions, type RawChildActions } from './child-actions'
import type {
  Actions,
  BindTarget,
  ChildBinding,
  ChildBindingId,
  ChildStateOf,
  CurrentOf,
  FlowOf,
  ProviderProps,
  ReactBinding,
  StateOf,
  UseStepResult,
} from './types'

// ---------------------------------------------------------------------------
// bindReact
// ---------------------------------------------------------------------------

/**
 * Create a typed React binding for a flow or a projection. The type parameter is the only
 * link to the definition (`bindReact<typeof checkoutClient>()`); the live `Wizard` / `Mirror`
 * is supplied through `<Provider source={…}>`.
 * @public
 */
export function bindReact<T extends BindTarget>(): ReactBinding<T> {
  const Context = createContext<Bound | null>(null)

  const useBound = (hook: string): Bound => {
    const bound = useContext(Context)
    if (bound === null) {
      throw new Error(
        `${hook}() must be used inside the <Provider> of the same bindReact() binding`,
      )
    }
    return bound
  }

  /** `useSyncExternalStore` over the source: `read` for the live state, `readServer` for SSR/hydration. */
  const useRead = <R,>(
    bound: Bound,
    read: (state: RawState | null) => R,
    readServer: (state: RawState | null) => R = read,
  ): R =>
    useSyncExternalStore(
      bound.adapter.subscribe,
      () => read(bound.adapter.getState()),
      () => readServer(bound.getServerState()),
    )

  const useSourceState = (bound: Bound): RawState => {
    const state = useRead(bound, (s) => s)
    if (state === null) {
      throw new Error('the source has no state yet (render hooks under a <Provider> with fallback)')
    }
    return state
  }

  function Provider({
    source,
    fallback,
    serverSnapshot,
    children,
  }: ProviderProps<T>): ReactElement | null {
    const adapter = useMemo(() => adapt(source), [source])
    // Captured once: the server snapshot must not change between server render and hydration.
    const [fixed] = useState<RawState | null | undefined>(() =>
      serverSnapshot === undefined ? undefined : (serverSnapshot as unknown as RawState),
    )
    const bound = useMemo<Bound>(
      () => ({
        adapter,
        getServerState: fixed === undefined ? adapter.getState : () => fixed,
        getServerChildState:
          fixed === undefined
            ? adapter.getChildState
            : (path) => (fixed === null ? null : adapter.childOfServerState(fixed, path)),
      }),
      [adapter, fixed],
    )
    const ready = useRead(bound, (s) => s !== null)
    if (!ready) return <Fragment>{fallback ?? null}</Fragment>
    return <Context.Provider value={bound}>{children}</Context.Provider>
  }

  function useSnapshot(): StateOf<T> {
    return useSourceState(useBound('useSnapshot')) as StateOf<T>
  }

  function useCurrent(): CurrentOf<T> {
    const bound = useBound('useCurrent')
    const read = (state: RawState | null): unknown => {
      if (state === null || state.current === null) return null
      return state.steps[state.current] ?? null
    }
    return useRead(bound, read) as CurrentOf<T>
  }

  function useSelector<R>(
    select: (state: StateOf<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is,
  ): R {
    const bound = useBound('useSelector')
    // Memo caches (one for the live state, one for the server snapshot): same (state, select) →
    // same selection; otherwise recompute and keep the previous selection reference when
    // `isEqual` says nothing changed (stable identity for useSyncExternalStore even with inline
    // selectors returning fresh objects).
    const cache = useRef<{ state: unknown; select: unknown; selection: R } | null>(null)
    const serverCache = useRef<{ state: unknown; select: unknown; selection: R } | null>(null)
    const selectWith =
      (slot: typeof cache) =>
      (state: RawState | null): R => {
        const cached = slot.current
        if (cached !== null && cached.state === state && cached.select === select) {
          return cached.selection
        }
        const next = select(state as StateOf<T>)
        if (cached !== null && isEqual(cached.selection, next)) {
          slot.current = { state, select, selection: cached.selection }
          return cached.selection
        }
        slot.current = { state, select, selection: next }
        return next
      }
    return useRead(bound, selectWith(cache), selectWith(serverCache))
  }

  function useStep<K extends StepId<FlowOf<T>>>(step: K): UseStepResult<T, K> {
    const bound = useBound('useStep')
    const read = (state: RawState | null): unknown => {
      const record = state === null ? undefined : state.steps[step]
      if (record === undefined) throw new Error(`useStep('${step}'): unknown step`)
      return record
    }
    const record = useRead(bound, read) as object
    const helpers = useMemo(() => bindStep(bound.adapter.actions, step), [bound, step])
    return useMemo(
      () => ({ ...record, ...helpers }) as unknown as UseStepResult<T, K>,
      [record, helpers],
    )
  }

  function useActions(): Actions<T> {
    return useBound('useActions').adapter.actions as unknown as Actions<T>
  }

  // ---- child bindings (memoised per path so the returned hooks keep their identity) ---------

  /** Untyped child binding: hooks over the child slice at `path`, actions scoped to it. */
  interface RawChildBinding {
    useSnapshot(): RawState | null
    useStep(step: string): unknown
    useActions(): RawChildActions
    useChild(step: string): RawChildBinding
  }
  const childBindings = new Map<string, RawChildBinding>()

  const childBinding = (path: readonly string[]): RawChildBinding => {
    const key = JSON.stringify(path)
    const existing = childBindings.get(key)
    if (existing !== undefined) return existing
    const label = `useChild(${path.map((p) => `'${p}'`).join(').useChild(')})`
    const useSlice = (bound: Bound): RawState | null =>
      useSyncExternalStore(
        bound.adapter.subscribe,
        () => bound.adapter.getChildState(path),
        () => bound.getServerChildState(path),
      )
    const binding: RawChildBinding = {
      useSnapshot() {
        return useSlice(useBound(`${label}.useSnapshot`))
      },
      useStep(step) {
        const bound = useBound(`${label}.useStep`)
        const read = (slice: RawState | null): unknown => {
          if (slice === null) {
            throw new Error(
              `${label}.useStep('${step}'): the child flow has no state yet (render it under a useSnapshot() !== null guard)`,
            )
          }
          const record = slice.steps[step]
          if (record === undefined) throw new Error(`${label}.useStep('${step}'): unknown step`)
          return record
        }
        const record = useSyncExternalStore(
          bound.adapter.subscribe,
          () => read(bound.adapter.getChildState(path)),
          () => read(bound.getServerChildState(path)),
        )
        // `path` is a constant of this (memoised) binding, so it is a valid dependency as-is.
        const helpers = useMemo(
          () => bindStep(childActions(bound.adapter.actions, path), step),
          [bound, step, path],
        )
        return useMemo(() => ({ ...(record as object), ...helpers }), [record, helpers])
      },
      useActions() {
        return childActions(useBound(`${label}.useActions`).adapter.actions, path)
      },
      useChild: (step) => childBinding([...path, step]),
    }
    childBindings.set(key, binding)
    return binding
  }

  type ChildBindingOf<K extends ChildBindingId<T>> = ChildBinding<
    ChildFlowOf<FlowOf<T>, K & StepId<FlowOf<T>>>,
    ChildStateOf<T, K>,
    T extends AnyProjection ? 'mirror' : 'wizard'
  >
  function useChild<K extends ChildBindingId<T>>(step: K): ChildBindingOf<K> {
    useBound('useChild')
    return childBinding([step]) as unknown as ChildBindingOf<K>
  }

  return { Provider, useSnapshot, useCurrent, useStep, useSelector, useActions, useChild }
}

/** Per-step helpers (present for every step at runtime; the types hide view-only ones). */
function bindStep(actions: RawActions, step: string) {
  return {
    next: actions.next,
    back: actions.back,
    go: () => actions.go(step),
    setInput: (patch: unknown) => actions.setInput(step, patch),
    resetInput: () => actions.resetInput(step),
  }
}
