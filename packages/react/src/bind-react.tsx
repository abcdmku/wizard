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
 * @packageDocumentation
 */

import type { StepId } from '@openwizard/core'
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
import type {
  Actions,
  BindTarget,
  CurrentOf,
  FlowOf,
  ProviderProps,
  ReactBinding,
  StateOf,
  StepHelpers,
  StepRecordOf,
  UseStepResult,
} from './types'

// ---------------------------------------------------------------------------
// Source adapter (untyped inside; the public surface is typed by `T`)
// ---------------------------------------------------------------------------

/** Structural view of what `Wizard` and `Mirror` share (plus `getState`, Wizard only). */
interface RawSource extends RawActions {
  subscribe(listener: (state?: unknown) => void): () => void
  getSnapshot(): unknown
  getState?(): unknown
}

interface RawState {
  readonly current: string | null
  readonly steps: Readonly<Record<string, unknown>>
}

interface RawActions {
  start(): Promise<unknown>
  next(): Promise<unknown>
  back(): Promise<unknown>
  go(step: string): Promise<unknown>
  setInput(step: string, patch: unknown): Promise<unknown>
  resetInput(step: string): Promise<unknown>
  send(
    event: string,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<unknown>
  run(step: string): Promise<unknown>
  retry(step: string): Promise<unknown>
  cancel(reason?: string): Promise<unknown>
  runReady(): Promise<unknown>
  compensate(options?: { readonly from?: string; readonly reason?: string }): Promise<unknown>
  reset(): Promise<unknown>
  dispatch(command: unknown): Promise<unknown>
}

interface Adapter {
  subscribe(listener: () => void): () => void
  /** The state the hooks read; `null` while a Mirror has no frame. */
  getState(): RawState | null
  readonly actions: RawActions
}

/** What a `Provider` puts in context: the source adapter plus the fixed server snapshot reader. */
interface Bound {
  readonly adapter: Adapter
  /** The state to render on the server and during hydration (`serverSnapshot`, else the live state). */
  getServerState(): RawState | null
}

const adapters = new WeakMap<object, Adapter>()

function adapt(source: object): Adapter {
  const existing = adapters.get(source)
  if (existing !== undefined) return existing
  const raw = source as RawSource
  const wizardState = raw.getState
  const getState =
    typeof wizardState === 'function'
      ? () => wizardState.call(raw) as RawState // Wizard: the state (never null)
      : () => raw.getSnapshot() as RawState | null // Mirror: projected state, null before the first frame
  const adapter: Adapter = {
    subscribe: (listener) => raw.subscribe(() => listener()),
    getState,
    actions: {
      start: () => raw.start(),
      next: () => raw.next(),
      back: () => raw.back(),
      go: (step) => raw.go(step),
      setInput: (step, patch) => raw.setInput(step, patch),
      resetInput: (step) => raw.resetInput(step),
      send: (event, payload, options) =>
        options === undefined ? raw.send(event, payload) : raw.send(event, payload, options),
      run: (step) => raw.run(step),
      retry: (step) => raw.retry(step),
      cancel: (reason) => (reason === undefined ? raw.cancel() : raw.cancel(reason)),
      runReady: () => raw.runReady(),
      compensate: (options) => (options === undefined ? raw.compensate() : raw.compensate(options)),
      reset: () => raw.reset(),
      dispatch: (command) => raw.dispatch(command),
    },
  }
  adapters.set(source, adapter)
  return adapter
}

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
    const record = useRead(bound, read) as StepRecordOf<T, K>
    const helpers = useMemo(
      () => bindStep(bound.adapter.actions, step) as unknown as StepHelpers<T, K>,
      [bound, step],
    )
    return useMemo(() => ({ ...record, ...helpers }), [record, helpers])
  }

  function useActions(): Actions<T> {
    return useBound('useActions').adapter.actions as unknown as Actions<T>
  }

  return { Provider, useSnapshot, useCurrent, useStep, useSelector, useActions }
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
