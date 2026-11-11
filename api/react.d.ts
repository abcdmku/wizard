import { DependencyList, ReactElement, ReactNode } from "react";
import { AnyProjection, AnyWizardDefinition, ChildStepId, ChildWizardOf, Command, CommandResult, Ctx, DraftOf, EventType, Explanation, IsEach, Issue, NavResult, PayloadInput, Progress, ProjectionOutput, ProjectionWizard, RetryStepId, Run, RunStepId, SendOptions, SendResult, Snapshot, StepId, StepPhase, ViewId } from "@openwizard/core";
import { Mirror, MirrorChild, MirrorResult } from "@openwizard/core/mirror";
//#region src/types.d.ts
/**
 * What `bindReact<T>()` accepts: a wizard (the source is a `Run`) or a projection (the source
 * is a `Mirror`).
 * @public
 */
type BindTarget = AnyWizardDefinition | AnyProjection;
/**
 * The wizard behind a bind target (the projection's wizard, or the wizard itself).
 * @public
 */
type WizardOf<T extends BindTarget> = T extends AnyProjection ? ProjectionWizard<T> : T extends AnyWizardDefinition ? T : never;
/**
 * The live object a binding's `Provider` takes: `Run<F>` for a wizard, `Mirror<P>` for a projection.
 * @public
 */
type SourceOf<T extends BindTarget> = T extends AnyProjection ? Mirror<T> : T extends AnyWizardDefinition ? Run<T> : never;
/**
 * The state the hooks read: `Snapshot<F>['state']` over a Run, `ProjectionOutput<P>`
 * (the projected `ClientState`) over a Mirror.
 * @public
 */
type StateOf<T extends BindTarget> = T extends AnyProjection ? ProjectionOutput<T> : T extends AnyWizardDefinition ? Snapshot<T>['state'] : never;
/**
 * Result of the commands that are not navigation or `send`: `CommandResult` from a Run, a
 * `MirrorResult` (the ack's `CommandResult` or `TRANSPORT_FAILED`) from a Mirror.
 * @public
 */
type CommandResultOf<T extends BindTarget> = T extends AnyProjection ? MirrorResult : CommandResult;
/**
 * Result of the navigation actions: `NavResult` from a Run, a `MirrorResult` from a Mirror.
 * @public
 */
type NavResultOf<T extends BindTarget> = T extends AnyProjection ? MirrorResult : NavResult;
/**
 * Result of the `send` action: `SendResult` from a Run, a `MirrorResult` from a Mirror.
 * @public
 */
type SendResultOf<T extends BindTarget> = T extends AnyProjection ? MirrorResult : SendResult;
/**
 * The command methods of the source (`useActions()`) — the same sugar as `Run` / `Mirror`,
 * typed by the wizard; one stable object per source. `send` checks the payload against the
 * event's schema type (an `unknown` value is accepted and parsed by the event boundary).
 * @public
 */
interface Actions<T extends BindTarget> {
  start(): Promise<CommandResultOf<T>>;
  next(): Promise<NavResultOf<T>>;
  back(): Promise<NavResultOf<T>>;
  go(step: ViewId<WizardOf<T>>): Promise<NavResultOf<T>>;
  setInput<K extends ViewId<WizardOf<T>>>(step: K, patch: DraftOf<WizardOf<T>, K>): Promise<CommandResultOf<T>>;
  resetInput(step: ViewId<WizardOf<T>>): Promise<CommandResultOf<T>>;
  send<E extends EventType<WizardOf<T>>, P>(event: E, payload: P & (unknown extends P ? unknown : PayloadInput<WizardOf<T>, E>), options?: SendOptions): Promise<SendResultOf<T>>;
  startStep(step: RunStepId<WizardOf<T>>): Promise<CommandResultOf<T>>;
  retry(step: RetryStepId<WizardOf<T>>, options?: {
    readonly patch?: Partial<Ctx<WizardOf<T>>>;
  }): Promise<CommandResultOf<T>>;
  cancel(reason?: string): Promise<CommandResultOf<T>>;
  startReady(): Promise<CommandResultOf<T>>;
  compensate(options?: {
    readonly from?: StepId<WizardOf<T>>;
    readonly reason?: string;
  }): Promise<CommandResultOf<T>>;
  reset(): Promise<CommandResultOf<T>>;
  skip(step: StepId<WizardOf<T>>, reason?: string): Promise<CommandResultOf<T>>;
  invalidate(step: StepId<WizardOf<T>>, options?: {
    readonly cascade?: boolean;
  }): Promise<CommandResultOf<T>>;
  dispatch(command: Command<WizardOf<T>>): Promise<CommandResultOf<T>>;
}
/**
 * `useActions()` over a Run: the commands plus the run's pure queries — `validate(view)`
 * (the view's issues over its current draft), `explain(step)` and `progress()`. Queries read
 * the run at call time; they do not subscribe the component.
 * @public
 */
interface RunActions<F extends AnyWizardDefinition> extends Actions<F> {
  validate(step: ViewId<F>): Promise<readonly Issue[]>;
  explain(step: StepId<F>): Explanation<F>;
  progress(): Progress;
}
/**
 * What `useActions()` returns: `RunActions` over a Run, `Actions` over a Mirror.
 * @public
 */
type ActionsOf<T extends BindTarget> = T extends AnyProjection ? Actions<T> : RunActions<WizardOf<T>>;
/**
 * The record of step `K` of a state slice `S` (a projected `ClientState` or a run state):
 * `S['steps'][K]`, `never` when `S` has no such step (a `select` projection whose state is not
 * step-shaped).
 * @public
 */
type StepRecordIn<S, K extends PropertyKey> = S extends {
  readonly steps: infer St;
} ? K extends keyof St ? St[K] : never : never;
/**
 * The record of step `K` as the hooks see it: the projected `ClientStepState` over a Mirror, the
 * `StepState` over a Run plus its live `phase` (`validating` while a view's `validate` hook
 * runs, `running`, `retrying`, `waiting`, …) — the same fact a projected record carries.
 * @public
 */
type StepRecordOf<T extends BindTarget, K extends StepId<WizardOf<T>>> = T extends AnyProjection ? StepRecordIn<StateOf<T>, K> : StepRecordIn<StateOf<T>, K> & {
  readonly phase?: StepPhase;
};
/**
 * The field names of view `K`'s draft (what `issuesFor(field)` accepts).
 * @public
 */
type FieldOf<F extends AnyWizardDefinition, K extends StepId<F>> = keyof NonNullable<DraftOf<F, K>> & string;
/**
 * `issuesFor(field)` lists a view's issues whose path starts at `field` (`issuesFor()`: the
 * issues without a path, e.g. a whole-object check). Offered only where record `R` carries
 * `issues`: always over a Run, over a projection for a view exposed with `issues: true`.
 * @internal
 */
type IssuesFor<R, F extends AnyWizardDefinition, K extends StepId<F>> = 'issues' extends keyof R ? {
  readonly issuesFor: (field?: FieldOf<F, K>) => readonly Issue[];
} : {};
/**
 * Helpers `useStep(id)` binds to a VIEW step (other steps get none): `next` / `back` navigate
 * from this view — when it is not the current view they resolve `{ ok: false, code:
 * 'NOT_ACTIVE' }` without sending anything —, `go` moves the cursor to it, `setInput` patches its
 * draft (`DraftOf`), `resetInput` restores it, and `issuesFor(field)` lists the issues whose
 * path starts at `field` (only where the record carries `issues`).
 * @public
 */
type StepHelpers<T extends BindTarget, K extends StepId<WizardOf<T>>> = K extends ViewId<WizardOf<T>> ? {
  readonly next: () => Promise<NavResultOf<T>>;
  readonly back: () => Promise<NavResultOf<T>>;
  readonly go: () => Promise<NavResultOf<T>>;
  readonly setInput: (patch: DraftOf<WizardOf<T>, K>) => Promise<CommandResultOf<T>>;
  readonly resetInput: () => Promise<CommandResultOf<T>>;
} & IssuesFor<StepRecordOf<T, K>, WizardOf<T>, K> : {};
/**
 * What `useStep(id)` returns: the typed step record with the bound helpers spread in
 * (`const { status, phase, input, issuesFor, setInput, next } = ow.useStep('shipping')`).
 * @public
 */
type UseStepResult<T extends BindTarget, K extends StepId<WizardOf<T>>> = StepRecordOf<T, K> & StepHelpers<T, K>;
/**
 * What `useCurrent()` returns: the record of the current view step, or `null`.
 * @public
 */
type CurrentOf<T extends BindTarget> = { [K in ViewId<WizardOf<T>>]: StepRecordOf<T, K>; }[ViewId<WizardOf<T>>] | null;
//#endregion
//#region src/binding-types.d.ts
/**
 * `Provider` props: the `source` (`Run` or `Mirror`), an optional `fallback` rendered until
 * the source has state (a Mirror before its first frame), and `children`.
 *
 * Server rendering reads the source as it is. Seed the client source with the state the server
 * rendered — `createMirror({ initial: frame })` for a Mirror, `wizard.resume(snapshot)` for a run — and
 * create it during render (`useRun`), so hydration sees that same state and commands work at once.
 * @public
 */
interface ProviderProps<T extends BindTarget> {
  readonly source: SourceOf<T>;
  readonly fallback?: ReactNode;
  readonly children?: ReactNode;
}
/** One nested child state, including an indexed element of a mapped child's nullable array. */
type ChildSliceOf<R> = R extends {
  readonly child?: infer CS;
} ? NonNullable<CS> extends readonly (infer Item)[] ? ChildState<NonNullable<Item>> : ChildState<NonNullable<CS>> : never;
type ChildState<S> = [S] extends [{
  readonly steps: unknown;
}] ? S : never;
type ChildIndex<F extends AnyWizardDefinition, K extends StepId<F>> = true extends IsEach<F, K> ? [index: number] : [index?: never];
/**
 * The steps of wizard `F` whose record in the projected slice `S` carries a nested child state
 * (exposed with `child: ExposeSpec`) — the only children a Mirror binding can read.
 * @public
 */
type ExposedChildId<F extends AnyWizardDefinition, S> = { [K in StepId<F>]: [ChildSliceOf<StepRecordIn<S, K>>] extends [never] ? never : K; }[StepId<F>];
/**
 * Ids of the child steps whose child state the binding can read with `useChild`: over a
 * projection, the child steps exposed with a nested `child: ExposeSpec` (their projected slice
 * carries `steps`); over a Run, every child step. Mapped steps require an input index.
 * @public
 */
type ChildBindingId<T extends BindTarget> = T extends AnyProjection ? ExposedChildId<WizardOf<T>, StateOf<T>> : ChildStepId<WizardOf<T>>;
/**
 * The selected child slice `useChild` reads: one projected `ClientState` over a projection,
 * `Snapshot<Child>['state']` over a Run.
 * @public
 */
type ChildStateOf<T extends BindTarget, K extends ChildBindingId<T>> = T extends AnyProjection ? ChildSliceOf<StepRecordIn<StateOf<T>, K>> : Snapshot<ChildWizardOf<WizardOf<T>, K & StepId<WizardOf<T>>>>['state'];
/**
 * Helpers `useChild(step).useStep(id)` binds to a child VIEW step: the scoped `MirrorChild`
 * sugar of the child wizard with the same rules as `StepHelpers` (`next` / `back` only from the
 * child's current view; `issuesFor` only where the child record `R` carries `issues`).
 * @public
 */
type ChildStepHelpers<CF extends AnyWizardDefinition, K extends StepId<CF>, R> = K extends ViewId<CF> ? {
  readonly next: () => Promise<MirrorResult>;
  readonly back: () => Promise<MirrorResult>;
  readonly go: () => Promise<MirrorResult>;
  readonly setInput: (patch: DraftOf<CF, K>) => Promise<MirrorResult>;
  readonly resetInput: () => Promise<MirrorResult>;
} & IssuesFor<R, CF, K> : {};
/**
 * What `useChild(step)` returns: hooks bound to the child slice of the state (`S`), typed by the
 * child wizard `CF`. `useSnapshot()` is `null` while the child has no state (its child step has not
 * been entered); `useStep` throws in that case, so render it under a `useSnapshot()` guard.
 * `useActions()` is the scoped `MirrorChild` sugar (every command wrapped as a `child` command);
 * `useChild` nests further (`Source` says how the grandchild slice is read: `'mirror'` from
 * `steps[step].child` of this slice — only the grandchildren the projection exposes with a
 * nested `child: ExposeSpec` —, `'run'` from the child snapshot's `children[step]`, every
 * child step).
 * @public
 */
interface ChildBinding<CF extends AnyWizardDefinition, S, Source extends 'run' | 'mirror' = 'mirror'> {
  /** The child slice, or `null` before the child exists. */
  useSnapshot(): S | null;
  /** One child step's record (+ its live `phase` over a Run) and bound helpers; throws while the child has no state. */
  useStep<K extends StepId<CF>>(step: K): StepRecordIn<S, K> & (Source extends 'run' ? {
    readonly phase?: StepPhase;
  } : {}) & ChildStepHelpers<CF, K, StepRecordIn<S, K>>;
  /** The child's command sugar (stable identity per source and path). */
  useActions(): MirrorChild<CF>;
  /** A grandchild binding. Mapped grandchildren require their input index. */
  useChild<K extends Source extends 'run' ? ChildStepId<CF> : ExposedChildId<CF, S>>(step: K, ...selection: ChildIndex<CF, K & StepId<CF>>): ChildBinding<ChildWizardOf<CF, K & StepId<CF>>, Source extends 'run' ? Snapshot<ChildWizardOf<CF, K & StepId<CF>>>['state'] : ChildSliceOf<StepRecordIn<S, K>>, Source>;
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
  useStep<K extends StepId<WizardOf<T>>>(step: K): UseStepResult<T, K>;
  /** A derived value; re-renders when `isEqual` (default `Object.is`) says it changed. */
  useSelector<R>(select: (state: StateOf<T>) => R, isEqual?: (a: R, b: R) => boolean): R;
  /** The source's command methods (+ the run's queries over a Run); stable identity per source. */
  useActions(): ActionsOf<T>;
  /**
   * Hooks bound to a nested run (`steps[step].child` of the projected state — the child step
   * must be exposed with `child: ExposeSpec` — or the live child state over a Run).
   * Mapped steps require `useChild(step, index)`. Identities stay stable per selected path.
   */
  useChild<K extends ChildBindingId<T>>(step: K, ...selection: ChildIndex<WizardOf<T>, K & StepId<WizardOf<T>>>): ChildBinding<ChildWizardOf<WizardOf<T>, K & StepId<WizardOf<T>>>, ChildStateOf<T, K>, T extends AnyProjection ? 'mirror' : 'run'>;
}
/**
 * A Mirror's transport connection as `useConnection()` reads it: `connected` is true from the
 * first frame of the current subscription until the transport closes; `connect(transport?)`
 * re-subscribes (reconnect, or attach a transport later) without remounting the tree.
 * @public
 */
interface Connection<P extends AnyProjection> {
  readonly connected: boolean;
  readonly connect: Mirror<P>['connect'];
}
/**
 * What `bindReact<typeof projection>()` returns: the `ReactBinding` hooks plus
 * `useConnection()` (offline banners, a reconnect button), which re-renders when the
 * transport connects or drops. On the server and during hydration it reads `connected: false`.
 * @public
 */
interface MirrorBinding<P extends AnyProjection> extends ReactBinding<P> {
  useConnection(): Connection<P>;
}
/**
 * What `bindReact<T>()` returns: a `MirrorBinding` for a projection, a `ReactBinding` for a wizard.
 * @public
 */
type BindingOf<T extends BindTarget> = T extends AnyProjection ? MirrorBinding<T> : ReactBinding<T>;
//#endregion
//#region src/bind-react.d.ts
/**
 * Create a typed React binding for a wizard or a projection. The type parameter is the only
 * link to the definition (`bindReact<typeof checkoutClient>()`); the live `Run` / `Mirror`
 * is supplied through `<Provider source={…}>`.
 * @public
 */
declare function bindReact<T extends BindTarget>(): BindingOf<T>;
//#endregion
//#region src/use-run.d.ts
/**
 * Own a run or a Mirror inside a component, StrictMode-safe: `create` runs during the first
 * render (and again when a value in `deps` changes, disposing the previous source); the source
 * is disposed after the component unmounts. Start the run in an effect — `start()` on a started
 * run is a no-op result, so StrictMode's effect replay is harmless.
 *
 * ```tsx
 * const run = useRun(() => checkout.create({ cartId }), [cartId])
 * useEffect(() => void run.start(), [run])
 * return <ow.Provider source={run}>…</ow.Provider>
 * ```
 * @public
 */
declare function useRun<S extends {
  dispose(): void;
}>(create: () => S, deps?: DependencyList): S;
//#endregion
export { type Actions, type ActionsOf, type BindTarget, type BindingOf, type ChildBinding, type ChildBindingId, type ChildStateOf, type ChildStepHelpers, type CommandResultOf, type Connection, type CurrentOf, type ExposedChildId, type FieldOf, type MirrorBinding, type NavResultOf, type ProviderProps, type ReactBinding, type RunActions, type SendResultOf, type SourceOf, type StateOf, type StepHelpers, type StepRecordIn, type StepRecordOf, type UseStepResult, type WizardOf, bindReact, useRun };
//# sourceMappingURL=index.d.ts.map