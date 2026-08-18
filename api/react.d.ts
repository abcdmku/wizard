import { ReactElement, ReactNode } from "react";
import { AnyFlow, AnyProjection, Command, CommandResult, DraftOf, EventType, Mirror, NavResult, ProjectionFlow, ProjectionOutput, SendResult, Snapshot, StepId, TaskId, ViewId, Wizard } from "@openwizard/core";
//#region src/types.d.ts
/**
 * What `bindReact<T>()` accepts: a flow (the source is a `Wizard`) or a projection (the source
 * is a `Mirror`).
 * @public
 */
type BindTarget = AnyFlow | AnyProjection;
/**
 * The flow behind a bind target (the projection's flow, or the flow itself).
 * @public
 */
type FlowOf<T extends BindTarget> = T extends AnyProjection ? ProjectionFlow<T> : T extends AnyFlow ? T : never;
/**
 * The live object a binding's `Provider` takes: `Wizard<F>` for a flow, `Mirror<P>` for a projection.
 * @public
 */
type SourceOf<T extends BindTarget> = T extends AnyProjection ? Mirror<T> : T extends AnyFlow ? Wizard<T> : never;
/**
 * The state the hooks read: `Snapshot<F>['state']` over a Wizard, `ProjectionOutput<P>`
 * (the projected `ClientState`) over a Mirror.
 * @public
 */
type StateOf<T extends BindTarget> = T extends AnyProjection ? ProjectionOutput<T> : T extends AnyFlow ? Snapshot<T>['state'] : never;
/**
 * Result of the navigation actions: `NavResult` from a Wizard, the ack's `CommandResult` from a Mirror.
 * @public
 */
type NavResultOf<T extends BindTarget> = T extends AnyProjection ? CommandResult : NavResult;
/**
 * Result of the `send` action: `SendResult` from a Wizard, the ack's `CommandResult` from a Mirror.
 * @public
 */
type SendResultOf<T extends BindTarget> = T extends AnyProjection ? CommandResult : SendResult;
/**
 * The command methods of the source (`useActions()`) — the same sugar as `Wizard` / `Mirror`,
 * typed by the flow; one stable object per source.
 * @public
 */
interface Actions<T extends BindTarget> {
  start(): Promise<CommandResult>;
  next(): Promise<NavResultOf<T>>;
  back(): Promise<NavResultOf<T>>;
  go(step: ViewId<FlowOf<T>>): Promise<NavResultOf<T>>;
  setInput<K extends ViewId<FlowOf<T>>>(step: K, patch: DraftOf<FlowOf<T>, K>): Promise<CommandResult>;
  resetInput(step: ViewId<FlowOf<T>>): Promise<CommandResult>;
  send<E extends EventType<FlowOf<T>>>(event: E, payload: unknown, options?: {
    readonly correlationId?: string;
  }): Promise<SendResultOf<T>>;
  run(step: TaskId<FlowOf<T>>): Promise<CommandResult>;
  retry(step: TaskId<FlowOf<T>>): Promise<CommandResult>;
  cancel(reason?: string): Promise<CommandResult>;
  runReady(): Promise<CommandResult>;
  compensate(options?: {
    readonly from?: StepId<FlowOf<T>>;
    readonly reason?: string;
  }): Promise<CommandResult>;
  reset(): Promise<CommandResult>;
  dispatch(command: Command<FlowOf<T>>): Promise<CommandResult>;
}
/**
 * The record of step `K` as the hooks see it (`StepState` over a Wizard, the projected
 * `ClientStepState` over a Mirror).
 * @public
 */
type StepRecordOf<T extends BindTarget, K extends StepId<FlowOf<T>>> = StateOf<T>['steps'][K];
/**
 * Helpers `useStep(id)` binds to the step: `next`/`back` (flow-level navigation) for every step;
 * `go` (to this view), `setInput` (draft patch, `DraftOf`) and `resetInput` for view steps only.
 * @public
 */
type StepHelpers<T extends BindTarget, K extends StepId<FlowOf<T>>> = {
  readonly next: () => Promise<NavResultOf<T>>;
  readonly back: () => Promise<NavResultOf<T>>;
} & (K extends ViewId<FlowOf<T>> ? {
  readonly go: () => Promise<NavResultOf<T>>;
  readonly setInput: (patch: DraftOf<FlowOf<T>, K>) => Promise<CommandResult>;
  readonly resetInput: () => Promise<CommandResult>;
} : {});
/**
 * What `useStep(id)` returns: the typed step record with the bound helpers spread in
 * (`const { status, input, issues, setInput, next } = ow.useStep('shipping')`).
 * @public
 */
type UseStepResult<T extends BindTarget, K extends StepId<FlowOf<T>>> = StepRecordOf<T, K> & StepHelpers<T, K>;
/**
 * What `useCurrent()` returns: the record of the current view step, or `null`.
 * @public
 */
type CurrentOf<T extends BindTarget> = { [K in ViewId<FlowOf<T>>]: StepRecordOf<T, K>; }[ViewId<FlowOf<T>>] | null;
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
interface ProviderProps<T extends BindTarget> {
  readonly source: SourceOf<T>;
  readonly fallback?: ReactNode;
  readonly serverSnapshot?: StateOf<T>;
  readonly children?: ReactNode;
}
/**
 * What `bindReact<T>()` returns: a `Provider` plus hooks typed by `T`. Every hook must be used
 * inside this binding's `Provider`; all reads go through `useSyncExternalStore` with stable
 * snapshot identities, so a hook re-renders only when its slice changes.
 * @public
 */
interface ReactBinding<T extends BindTarget> {
  readonly Provider: (props: ProviderProps<T>) => ReactElement | null;
  /** The whole state (re-renders on every commit). */
  useSnapshot(): StateOf<T>;
  /** The current view's record or `null`. */
  useCurrent(): CurrentOf<T>;
  /** One step's record + bound helpers; re-renders only when that step's slice changes. */
  useStep<K extends StepId<FlowOf<T>>>(step: K): UseStepResult<T, K>;
  /** A derived value; re-renders when `isEqual` (default `Object.is`) says it changed. */
  useSelector<R>(select: (state: StateOf<T>) => R, isEqual?: (a: R, b: R) => boolean): R;
  /** The source's command methods (stable identity per source). */
  useActions(): Actions<T>;
}
//#endregion
//#region src/bind-react.d.ts
/**
 * Create a typed React binding for a flow or a projection. The type parameter is the only
 * link to the definition (`bindReact<typeof checkoutClient>()`); the live `Wizard` / `Mirror`
 * is supplied through `<Provider source={…}>`.
 * @public
 */
declare function bindReact<T extends BindTarget>(): ReactBinding<T>;
//#endregion
export { type Actions, type BindTarget, type CurrentOf, type FlowOf, type NavResultOf, type ProviderProps, type ReactBinding, type SendResultOf, type SourceOf, type StateOf, type StepHelpers, type StepRecordOf, type UseStepResult, bindReact };
//# sourceMappingURL=index.d.ts.map