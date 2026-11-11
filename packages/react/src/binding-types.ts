/**
 * Public types of the hook bindings `bindReact<T>()` returns: the `Provider` props, the root
 * binding (`ReactBinding`, plus `useConnection` on a Mirror binding) and the child bindings
 * `useChild(step)` returns. Named interfaces on purpose (ADR-001 F7).
 *
 * @packageDocumentation
 */

import type {
  AnyProjection,
  AnyWizardDefinition,
  ChildStepId,
  ChildWizardOf,
  DraftOf,
  IsEach,
  Snapshot,
  StepId,
  StepPhase,
  ViewId,
} from '@openwizard/core'
import type { Mirror, MirrorChild, MirrorResult } from '@openwizard/core/mirror'
import type { ReactElement, ReactNode } from 'react'
import type {
  ActionsOf,
  BindTarget,
  CurrentOf,
  IssuesFor,
  SourceOf,
  StateOf,
  StepRecordIn,
  UseStepResult,
  WizardOf,
} from './types'

/**
 * `Provider` props: the `source` (`Run` or `Mirror`), an optional `fallback` rendered until
 * the source has state (a Mirror before its first frame), and `children`.
 *
 * Server rendering reads the source as it is. Seed the client source with the state the server
 * rendered — `createMirror({ initial: frame })` for a Mirror, `wizard.resume(snapshot)` for a run — and
 * create it during render (`useRun`), so hydration sees that same state and commands work at once.
 * @public
 */
export interface ProviderProps<T extends BindTarget> {
  readonly source: SourceOf<T>
  readonly fallback?: ReactNode
  readonly children?: ReactNode
}

/** One nested child state, including an indexed element of a mapped child's nullable array. */
type ChildSliceOf<R> = R extends { readonly child?: infer CS }
  ? NonNullable<CS> extends readonly (infer Item)[]
    ? ChildState<NonNullable<Item>>
    : ChildState<NonNullable<CS>>
  : never
type ChildState<S> = [S] extends [{ readonly steps: unknown }] ? S : never
type ChildIndex<F extends AnyWizardDefinition, K extends StepId<F>> =
  true extends IsEach<F, K> ? [index: number] : [index?: never]

/**
 * The steps of wizard `F` whose record in the projected slice `S` carries a nested child state
 * (exposed with `child: ExposeSpec`) — the only children a Mirror binding can read.
 * @public
 */
export type ExposedChildId<F extends AnyWizardDefinition, S> = {
  [K in StepId<F>]: [ChildSliceOf<StepRecordIn<S, K>>] extends [never] ? never : K
}[StepId<F>]

/**
 * Ids of the child steps whose child state the binding can read with `useChild`: over a
 * projection, the child steps exposed with a nested `child: ExposeSpec` (their projected slice
 * carries `steps`); over a Run, every child step. Mapped steps require an input index.
 * @public
 */
export type ChildBindingId<T extends BindTarget> = T extends AnyProjection
  ? ExposedChildId<WizardOf<T>, StateOf<T>>
  : ChildStepId<WizardOf<T>>

/**
 * The selected child slice `useChild` reads: one projected `ClientState` over a projection,
 * `Snapshot<Child>['state']` over a Run.
 * @public
 */
export type ChildStateOf<
  T extends BindTarget,
  K extends ChildBindingId<T>,
> = T extends AnyProjection
  ? ChildSliceOf<StepRecordIn<StateOf<T>, K>>
  : Snapshot<ChildWizardOf<WizardOf<T>, K & StepId<WizardOf<T>>>>['state']

/**
 * Helpers `useChild(step).useStep(id)` binds to a child VIEW step: the scoped `MirrorChild`
 * sugar of the child wizard with the same rules as `StepHelpers` (`next` / `back` only from the
 * child's current view; `issuesFor` only where the child record `R` carries `issues`).
 * @public
 */
export type ChildStepHelpers<CF extends AnyWizardDefinition, K extends StepId<CF>, R> =
  K extends ViewId<CF>
    ? {
        readonly next: () => Promise<MirrorResult>
        readonly back: () => Promise<MirrorResult>
        readonly go: () => Promise<MirrorResult>
        readonly setInput: (patch: DraftOf<CF, K>) => Promise<MirrorResult>
        readonly resetInput: () => Promise<MirrorResult>
      } & IssuesFor<R, CF, K>
    : {}

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
export interface ChildBinding<
  CF extends AnyWizardDefinition,
  S,
  Source extends 'run' | 'mirror' = 'mirror',
> {
  /** The child slice, or `null` before the child exists. */
  useSnapshot(): S | null
  /** One child step's record (+ its live `phase` over a Run) and bound helpers; throws while the child has no state. */
  useStep<K extends StepId<CF>>(
    step: K,
  ): StepRecordIn<S, K> &
    (Source extends 'run' ? { readonly phase?: StepPhase } : {}) &
    ChildStepHelpers<CF, K, StepRecordIn<S, K>>
  /** The child's command sugar (stable identity per source and path). */
  useActions(): MirrorChild<CF>
  /** A grandchild binding. Mapped grandchildren require their input index. */
  useChild<K extends Source extends 'run' ? ChildStepId<CF> : ExposedChildId<CF, S>>(
    step: K,
    ...selection: ChildIndex<CF, K & StepId<CF>>
  ): ChildBinding<
    ChildWizardOf<CF, K & StepId<CF>>,
    Source extends 'run'
      ? Snapshot<ChildWizardOf<CF, K & StepId<CF>>>['state']
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
  useStep<K extends StepId<WizardOf<T>>>(step: K): UseStepResult<T, K>
  /** A derived value; re-renders when `isEqual` (default `Object.is`) says it changed. */
  useSelector<R>(select: (state: StateOf<T>) => R, isEqual?: (a: R, b: R) => boolean): R
  /** The source's command methods (+ the run's queries over a Run); stable identity per source. */
  useActions(): ActionsOf<T>
  /**
   * Hooks bound to a nested run (`steps[step].child` of the projected state — the child step
   * must be exposed with `child: ExposeSpec` — or the live child state over a Run).
   * Mapped steps require `useChild(step, index)`. Identities stay stable per selected path.
   */
  useChild<K extends ChildBindingId<T>>(
    step: K,
    ...selection: ChildIndex<WizardOf<T>, K & StepId<WizardOf<T>>>
  ): ChildBinding<
    ChildWizardOf<WizardOf<T>, K & StepId<WizardOf<T>>>,
    ChildStateOf<T, K>,
    T extends AnyProjection ? 'mirror' : 'run'
  >
}

/**
 * A Mirror's transport connection as `useConnection()` reads it: `connected` is true from the
 * first frame of the current subscription until the transport closes; `connect(transport?)`
 * re-subscribes (reconnect, or attach a transport later) without remounting the tree.
 * @public
 */
export interface Connection<P extends AnyProjection> {
  readonly connected: boolean
  readonly connect: Mirror<P>['connect']
}

/**
 * What `bindReact<typeof projection>()` returns: the `ReactBinding` hooks plus
 * `useConnection()` (offline banners, a reconnect button), which re-renders when the
 * transport connects or drops. On the server and during hydration it reads `connected: false`.
 * @public
 */
export interface MirrorBinding<P extends AnyProjection> extends ReactBinding<P> {
  useConnection(): Connection<P>
}

/**
 * What `bindReact<T>()` returns: a `MirrorBinding` for a projection, a `ReactBinding` for a wizard.
 * @public
 */
export type BindingOf<T extends BindTarget> = T extends AnyProjection
  ? MirrorBinding<T>
  : ReactBinding<T>
