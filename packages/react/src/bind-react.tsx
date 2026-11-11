/**
 * `bindReact<T>()` — tRPC-style binding: the flow/projection is a TYPE parameter (a type-only
 * import on the client), the live instance is supplied through `Provider`. Returns a `Provider`
 * and hooks typed by `T`, all built on `useSyncExternalStore` over the source's own
 * `subscribe`/`getSnapshot`: snapshot identities are stable per commit/frame, so
 * `useStep`/`useSelector` re-render only when their slice changes. `useActions()` is the source
 * itself (its command sugar is this-free), so its identity is stable per source.
 *
 * Server rendering reads the live source, on the server and during hydration: seed the client
 * source with the state the server rendered (`createMirror({ initial })`, `wizard.resume(snapshot)`).
 *
 * Child flows: `useChild(step)` returns hooks bound to the child slice — over a Mirror the
 * `steps[step].child` slice of the projected state (exposed with `child: ExposeSpec`), over a
 * Run the selected child's state — and a scoped `MirrorChild`-shaped action set
 * (every command wrapped as `{ type: 'child', path, command }` through the source's `dispatch`).
 * Child bindings are memoised per (binding, path) so their hooks have stable identities.
 *
 * @packageDocumentation
 */

import type { AnyProjection, ChildFlowOf, IsEach, StepId } from '@openwizard/core'
import {
  createContext,
  Fragment,
  type ReactElement,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import { type Adapter, adapt, type RawState } from './adapter'
import type {
  BindingOf,
  ChildBinding,
  ChildBindingId,
  ChildStateOf,
  Connection,
  ProviderProps,
} from './binding-types'
import { childActions, type RawChildActions } from './child-actions'
import { appendChild, type ChildPath, wirePath } from './child-path'
import { stepResult, viewHelpers } from './step-helpers'
import type { ActionsOf, BindTarget, CurrentOf, FlowOf, StateOf, UseStepResult } from './types'

const offline = (): boolean => false

/**
 * Create a typed React binding for a flow or a projection. The type parameter is the only
 * link to the definition (`bindReact<typeof checkoutClient>()`); the live `Run` / `Mirror`
 * is supplied through `<Provider source={…}>`.
 * @public
 */
export function bindReact<T extends BindTarget>(): BindingOf<T> {
  const Context = createContext<Adapter | null>(null)

  const useAdapter = (hook: string): Adapter => {
    const adapter = useContext(Context)
    if (adapter === null) {
      throw new Error(
        `${hook}() must be used inside the <Provider> of the same bindReact() binding`,
      )
    }
    return adapter
  }

  /** `useSyncExternalStore` over the source's state (the live state on the server too). */
  const useRead = <R,>(adapter: Adapter, read: (state: RawState | null) => R): R => {
    const snapshot = () => read(adapter.getState())
    return useSyncExternalStore(adapter.subscribe, snapshot, snapshot)
  }

  const useSourceState = (adapter: Adapter): RawState => {
    const state = useRead(adapter, (s) => s)
    if (state === null) {
      throw new Error('the source has no state yet (render hooks under a <Provider> with fallback)')
    }
    return state
  }

  function Provider({ source, fallback, children }: ProviderProps<T>): ReactElement | null {
    const adapter = useMemo(() => adapt(source), [source])
    const ready = useRead(adapter, (s) => s !== null)
    if (!ready) return <Fragment>{fallback ?? null}</Fragment>
    return <Context.Provider value={adapter}>{children}</Context.Provider>
  }

  function useSnapshot(): StateOf<T> {
    return useSourceState(useAdapter('useSnapshot')) as StateOf<T>
  }

  function useCurrent(): CurrentOf<T> {
    const adapter = useAdapter('useCurrent')
    const read = (state: RawState | null): object | null => {
      if (state === null || state.current === null) return null
      return (state.steps[state.current] as object | undefined) ?? null
    }
    const record = useRead(adapter, read)
    const phase = useRead(adapter, (state) =>
      state === null || state.current === null ? undefined : adapter.phaseOf([], state.current),
    )
    return useMemo(
      () => (record === null ? null : stepResult(record, phase, undefined)),
      [record, phase],
    ) as CurrentOf<T>
  }

  function useSelector<R>(
    select: (state: StateOf<T>) => R,
    isEqual: (a: R, b: R) => boolean = Object.is,
  ): R {
    const adapter = useAdapter('useSelector')
    // Memo cache: same (state, select) → same selection; otherwise recompute and keep the
    // previous selection reference when `isEqual` says nothing changed (stable identity for
    // useSyncExternalStore even with inline selectors returning fresh objects).
    const cache = useRef<{ state: unknown; select: unknown; selection: R } | null>(null)
    return useRead(adapter, (state) => {
      const cached = cache.current
      if (cached !== null && cached.state === state && cached.select === select) {
        return cached.selection
      }
      const next = select(state as StateOf<T>)
      if (cached !== null && isEqual(cached.selection, next)) {
        cache.current = { state, select, selection: cached.selection }
        return cached.selection
      }
      cache.current = { state, select, selection: next }
      return next
    })
  }

  function useStep<K extends StepId<FlowOf<T>>>(step: K): UseStepResult<T, K> {
    const adapter = useAdapter('useStep')
    const read = (state: RawState | null): unknown => {
      const record = state === null ? undefined : state.steps[step]
      if (record === undefined) throw new Error(`useStep('${step}'): unknown step`)
      return record
    }
    const record = useRead(adapter, read) as { readonly kind?: unknown }
    const phase = useRead(adapter, () => adapter.phaseOf([], step))
    const isView = record.kind === 'view'
    const helpers = useMemo(
      () =>
        isView
          ? viewHelpers(
              adapter.actions,
              () => adapter.getState()?.current ?? null,
              `useStep('${step}')`,
              step,
            )
          : undefined,
      [adapter, step, isView],
    )
    return useMemo(
      () => stepResult(record, phase, helpers) as UseStepResult<T, K>,
      [record, phase, helpers],
    )
  }

  function useActions(): ActionsOf<T> {
    return useAdapter('useActions').actions as unknown as ActionsOf<T>
  }

  function useConnection(): Connection<AnyProjection> {
    const adapter = useAdapter('useConnection')
    const connected = useSyncExternalStore(adapter.subscribe, adapter.connected, offline)
    return useMemo(() => ({ connected, connect: adapter.connect }), [connected, adapter])
  }

  // ---- child bindings (memoised per path so the returned hooks keep their identity) ---------

  /** Untyped child binding: hooks over the child slice at `path`, actions scoped to it. */
  interface RawChildBinding {
    useSnapshot(): RawState | null
    useStep(step: string): unknown
    useActions(): RawChildActions
    useChild(step: string, index?: number): RawChildBinding
  }
  const childBindings = new Map<string, RawChildBinding>()

  const childBinding = (path: ChildPath): RawChildBinding => {
    const key = JSON.stringify(path)
    const existing = childBindings.get(key)
    if (existing !== undefined) return existing
    const label = `useChild(${path
      .map(({ step, index }) => (index === undefined ? `'${step}'` : `'${step}', ${index}`))
      .join(').useChild(')})`
    const useSlice = <R,>(adapter: Adapter, read: (slice: RawState | null) => R): R => {
      const snapshot = () => read(adapter.getChildState(path))
      return useSyncExternalStore(adapter.subscribe, snapshot, snapshot)
    }
    const binding: RawChildBinding = {
      useSnapshot() {
        return useSlice(useAdapter(`${label}.useSnapshot`), (slice) => slice)
      },
      useStep(step) {
        const adapter = useAdapter(`${label}.useStep`)
        const record = useSlice(adapter, (slice) => {
          if (slice === null) {
            throw new Error(
              `${label}.useStep('${step}'): the child flow has no state yet (render it under a useSnapshot() !== null guard)`,
            )
          }
          const found = slice.steps[step]
          if (found === undefined) throw new Error(`${label}.useStep('${step}'): unknown step`)
          return found
        }) as { readonly kind?: unknown }
        const phase = useRead(adapter, () => adapter.phaseOf(path, step))
        const isView = record.kind === 'view'
        // `path` and `label` are constants of this (memoised) binding: valid dependencies as-is.
        const helpers = useMemo(
          () =>
            isView
              ? viewHelpers(
                  childActions(adapter.actions, wirePath(path)),
                  () => adapter.getChildState(path)?.current ?? null,
                  `${label}.useStep('${step}')`,
                  step,
                )
              : undefined,
          [adapter, step, path, label, isView],
        )
        return useMemo(() => stepResult(record, phase, helpers), [record, phase, helpers])
      },
      useActions() {
        return childActions(useAdapter(`${label}.useActions`).actions, wirePath(path))
      },
      useChild: (step, index) => childBinding(appendChild(path, step, index)),
    }
    childBindings.set(key, binding)
    return binding
  }

  type ChildBindingOf<K extends ChildBindingId<T>> = ChildBinding<
    ChildFlowOf<FlowOf<T>, K & StepId<FlowOf<T>>>,
    ChildStateOf<T, K>,
    T extends AnyProjection ? 'mirror' : 'run'
  >
  function useChild<K extends ChildBindingId<T>>(
    step: K,
    ...[index]: true extends IsEach<FlowOf<T>, K & StepId<FlowOf<T>>>
      ? [index: number]
      : [index?: never]
  ): ChildBindingOf<K> {
    useAdapter('useChild')
    return childBinding(appendChild([], step, index)) as unknown as ChildBindingOf<K>
  }

  return {
    Provider,
    useSnapshot,
    useCurrent,
    useStep,
    useSelector,
    useActions,
    useChild,
    useConnection,
  } as BindingOf<T>
}
