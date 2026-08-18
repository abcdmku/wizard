/**
 * Public types of the React binding. Everything is derived from the bind target `T` — a flow
 * (`bindReact<typeof flow>()`, source = `Wizard<F>`) or a projection
 * (`bindReact<typeof projection>()`, source = `Mirror<P>`, typed from a type-only import so no
 * server code reaches the client bundle). Named interfaces on purpose (ADR-001 F7): anonymous
 * object types would print the whole flow once per method in hover / `.d.ts` output.
 *
 * @packageDocumentation
 */

import type {
  AnyFlow,
  AnyProjection,
  ChildFlowOf,
  ChildStepId,
  Command,
  CommandResult,
  DraftOf,
  EventType,
  Mirror,
  MirrorChild,
  NavResult,
  ProjectionFlow,
  ProjectionOutput,
  SendResult,
  Snapshot,
  StepId,
  TaskId,
  ViewId,
  Wizard,
} from '@openwizard/core'

import type { ReactElement, ReactNode } from 'react'

/**
 * What `bindReact<T>()` accepts: a flow (the source is a `Wizard`) or a projection (the source
 * is a `Mirror`).
 * @public
 */
export type BindTarget = AnyFlow | AnyProjection

/**
 * The flow behind a bind target (the projection's flow, or the flow itself).
 * @public
 */
export type FlowOf<T extends BindTarget> = T extends AnyProjection
  ? ProjectionFlow<T>
  : T extends AnyFlow
    ? T
    : never

/**
 * The live object a binding's `Provider` takes: `Wizard<F>` for a flow, `Mirror<P>` for a projection.
 * @public
 */
export type SourceOf<T extends BindTarget> = T extends AnyProjection
  ? Mirror<T>
  : T extends AnyFlow
    ? Wizard<T>
    : never

/**
 * The state the hooks read: `Snapshot<F>['state']` over a Wizard, `ProjectionOutput<P>`
 * (the projected `ClientState`) over a Mirror.
 * @public
 */
export type StateOf<T extends BindTarget> = T extends AnyProjection
  ? ProjectionOutput<T>
  : T extends AnyFlow
    ? Snapshot<T>['state']
    : never

/**
 * Result of the navigation actions: `NavResult` from a Wizard, the ack's `CommandResult` from a Mirror.
 * @public
 */
export type NavResultOf<T extends BindTarget> = T extends AnyProjection ? CommandResult : NavResult

/**
 * Result of the `send` action: `SendResult` from a Wizard, the ack's `CommandResult` from a Mirror.
 * @public
 */
export type SendResultOf<T extends BindTarget> = T extends AnyProjection
  ? CommandResult
  : SendResult

/**
 * The command methods of the source (`useActions()`) — the same sugar as `Wizard` / `Mirror`,
 * typed by the flow; one stable object per source.
 * @public
 */
export interface Actions<T extends BindTarget> {
  start(): Promise<CommandResult>
  next(): Promise<NavResultOf<T>>
  back(): Promise<NavResultOf<T>>
  go(step: ViewId<FlowOf<T>>): Promise<NavResultOf<T>>
  setInput<K extends ViewId<FlowOf<T>>>(
    step: K,
    patch: DraftOf<FlowOf<T>, K>,
  ): Promise<CommandResult>
  resetInput(step: ViewId<FlowOf<T>>): Promise<CommandResult>
  send<E extends EventType<FlowOf<T>>>(
    event: E,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<SendResultOf<T>>
  run(step: TaskId<FlowOf<T>>): Promise<CommandResult>
  retry(step: TaskId<FlowOf<T>>): Promise<CommandResult>
  cancel(reason?: string): Promise<CommandResult>
  runReady(): Promise<CommandResult>
  compensate(options?: {
    readonly from?: StepId<FlowOf<T>>
    readonly reason?: string
  }): Promise<CommandResult>
  reset(): Promise<CommandResult>
  skip(step: StepId<FlowOf<T>>, reason?: string): Promise<CommandResult>
  invalidate(
    step: StepId<FlowOf<T>>,
    options?: { readonly cascade?: boolean },
  ): Promise<CommandResult>
  dispatch(command: Command<FlowOf<T>>): Promise<CommandResult>
}

/**
 * The record of step `K` of a state slice `S` (a projected `ClientState` or a wizard state):
 * `S['steps'][K]`, `never` when `S` has no such step (a `select` projection whose state is not
 * step-shaped).
 * @public
 */
export type StepRecordIn<S, K extends PropertyKey> = S extends { readonly steps: infer St }
  ? K extends keyof St
    ? St[K]
    : never
  : never

/**
 * The record of step `K` as the hooks see it (`StepState` over a Wizard, the projected
 * `ClientStepState` over a Mirror).
 * @public
 */
export type StepRecordOf<T extends BindTarget, K extends StepId<FlowOf<T>>> = StepRecordIn<
  StateOf<T>,
  K
>

/**
 * Helpers `useStep(id)` binds to the step: `next`/`back` (flow-level navigation) for every step;
 * `go` (to this view), `setInput` (draft patch, `DraftOf`) and `resetInput` for view steps only.
 * @public
 */
export type StepHelpers<T extends BindTarget, K extends StepId<FlowOf<T>>> = {
  readonly next: () => Promise<NavResultOf<T>>
  readonly back: () => Promise<NavResultOf<T>>
} & (K extends ViewId<FlowOf<T>>
  ? {
      readonly go: () => Promise<NavResultOf<T>>
      readonly setInput: (patch: DraftOf<FlowOf<T>, K>) => Promise<CommandResult>
      readonly resetInput: () => Promise<CommandResult>
    }
  : {})

/**
 * What `useStep(id)` returns: the typed step record with the bound helpers spread in
 * (`const { status, input, issues, setInput, next } = ow.useStep('shipping')`).
 * @public
 */
export type UseStepResult<T extends BindTarget, K extends StepId<FlowOf<T>>> = StepRecordOf<T, K> &
  StepHelpers<T, K>

/**
 * What `useCurrent()` returns: the record of the current view step, or `null`.
 * @public
 */
export type CurrentOf<T extends BindTarget> =
  | { [K in ViewId<FlowOf<T>>]: StepRecordOf<T, K> }[ViewId<FlowOf<T>>]
  | null

/**
 * `Provider` props: the `source` (`Wizard` or `Mirror`), an optional `fallback` rendered until
 * the source has state (a Mirror before its first frame), an optional `serverSnapshot` for
 * server rendering / hydration, and `children`.
 *
 * `serverSnapshot` is the state (`StateOf<T>`: the projected state over a Mirror, the wizard
 * state over a Wizard) the server rendered with. Captured once, on the first render, it is what
 * every hook reads on the server and during hydration (`useSyncExternalStore`'s server
 * snapshot), so the hydrated tree matches the server HTML even if the live source already
 * moved on; React then re-renders with the live state. Without it, hooks read the live source
 * on the server too (fine when the source is a Wizard created for the request).
 * @public
 */
export interface ProviderProps<T extends BindTarget> {
  readonly source: SourceOf<T>
  readonly fallback?: ReactNode
  readonly serverSnapshot?: StateOf<T>
  readonly children?: ReactNode
}

/** The nested child slice of a step record (`record.child`), `never` when it is not a state. */
type ChildSliceOf<R> = R extends { readonly child?: infer CS }
  ? [NonNullable<CS>] extends [{ readonly steps: unknown }]
    ? NonNullable<CS>
    : never
  : never

/**
 * Ids of the flow steps whose child state the binding can read with `useChild(step)`: over a
 * projection, the flow steps exposed with a nested `child: ExposeSpec` (their projected slice
 * carries `steps`); over a Wizard, every flow step (`Snapshot.children[step]`).
 * @public
 */
export type ChildBindingId<T extends BindTarget> = T extends AnyProjection
  ? {
      [K in StepId<FlowOf<T>>]: [ChildSliceOf<StepRecordIn<StateOf<T>, K>>] extends [never]
        ? never
        : K
    }[StepId<FlowOf<T>>]
  : ChildStepId<FlowOf<T>>

/**
 * The child slice `useChild(step)` reads: the projected child `ClientState` over a projection,
 * `Snapshot<Child>['state']` over a Wizard.
 * @public
 */
export type ChildStateOf<
  T extends BindTarget,
  K extends ChildBindingId<T>,
> = T extends AnyProjection
  ? ChildSliceOf<StepRecordIn<StateOf<T>, K>>
  : Snapshot<ChildFlowOf<FlowOf<T>, K & StepId<FlowOf<T>>>>['state']

/**
 * Helpers `useChild(step).useStep(id)` binds to a child step: the scoped `MirrorChild` sugar of
 * the child flow (`next` / `back` for every step; `go` / `setInput` / `resetInput` for views).
 * @public
 */
export type ChildStepHelpers<CF extends AnyFlow, K extends StepId<CF>> = {
  readonly next: () => Promise<CommandResult>
  readonly back: () => Promise<CommandResult>
} & (K extends ViewId<CF>
  ? {
      readonly go: () => Promise<CommandResult>
      readonly setInput: (patch: DraftOf<CF, K>) => Promise<CommandResult>
      readonly resetInput: () => Promise<CommandResult>
    }
  : {})

/**
 * What `useChild(step)` returns: hooks bound to the child slice of the state (`S`), typed by the
 * child flow `CF`. `useSnapshot()` is `null` while the child has no state (its flow step has not
 * been entered); `useStep` throws in that case, so render it under a `useSnapshot()` guard.
 * `useActions()` is the scoped `MirrorChild` sugar (every command wrapped as a `child` command);
 * `useChild` nests further (`Source` says how the grandchild slice is read: `'mirror'` from
 * `steps[step].child` of this slice, `'wizard'` from the child snapshot's `children[step]`).
 * @public
 */
export interface ChildBinding<
  CF extends AnyFlow,
  S,
  Source extends 'wizard' | 'mirror' = 'mirror',
> {
  /** The child slice, or `null` before the child exists. */
  useSnapshot(): S | null
  /** One child step's record + bound helpers; throws while the child has no state. */
  useStep<K extends StepId<CF>>(step: K): StepRecordIn<S, K> & ChildStepHelpers<CF, K>
  /** The child's command sugar (stable identity per source and path). */
  useActions(): MirrorChild<CF>
  /** A grandchild binding. */
  useChild<K extends ChildStepId<CF>>(
    step: K,
  ): ChildBinding<
    ChildFlowOf<CF, K>,
    Source extends 'wizard'
      ? Snapshot<ChildFlowOf<CF, K>>['state']
      : ChildSliceOf<StepRecordIn<S, K>>,
    Source
  >
}

/**
 * What `bindReact<T>()` returns: a `Provider` plus hooks typed by `T`. Every hook must be used
 * inside this binding's `Provider`; all reads go through `useSyncExternalStore` with stable
 * snapshot identities, so a hook re-renders only when its slice changes.
 * @public
 */
export interface ReactBinding<T extends BindTarget> {
  readonly Provider: (props: ProviderProps<T>) => ReactElement | null
  /** The whole state (re-renders on every commit). */
  useSnapshot(): StateOf<T>
  /** The current view's record or `null`. */
  useCurrent(): CurrentOf<T>
  /** One step's record + bound helpers; re-renders only when that step's slice changes. */
  useStep<K extends StepId<FlowOf<T>>>(step: K): UseStepResult<T, K>
  /** A derived value; re-renders when `isEqual` (default `Object.is`) says it changed. */
  useSelector<R>(select: (state: StateOf<T>) => R, isEqual?: (a: R, b: R) => boolean): R
  /** The source's command methods (stable identity per source). */
  useActions(): Actions<T>
  /**
   * Hooks bound to a nested flow (`steps[step].child` of the projected state — the flow step
   * must be exposed with `child: ExposeSpec` — or `Snapshot.children[step]` over a Wizard).
   * Stable identity per step, so `ow.useChild('fulfil').useStep('pick')` is fine inline.
   */
  useChild<K extends ChildBindingId<T>>(
    step: K,
  ): ChildBinding<
    ChildFlowOf<FlowOf<T>, K & StepId<FlowOf<T>>>,
    ChildStateOf<T, K>,
    T extends AnyProjection ? 'mirror' : 'wizard'
  >
}
