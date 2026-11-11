/**
 * Public types of the React binding's state, records and actions (the hook bindings themselves
 * are in `./binding-types`). Everything is derived from the bind target `T` — a wizard
 * (`bindReact<typeof wizard>()`, source = `Run<F>`) or a projection
 * (`bindReact<typeof projection>()`, source = `Mirror<P>`, typed from a type-only import so no
 * server code reaches the client bundle). Named interfaces on purpose (ADR-001 F7): anonymous
 * object types would print the whole run once per method in hover / `.d.ts` output.
 *
 * @packageDocumentation
 */

import type {
  AnyProjection,
  AnyWizardDefinition,
  Command,
  CommandResult,
  Ctx,
  DraftOf,
  EventType,
  Explanation,
  Issue,
  NavResult,
  PayloadInput,
  Progress,
  ProjectionOutput,
  ProjectionWizard,
  RetryStepId,
  Run,
  RunStepId,
  SendOptions,
  SendResult,
  Snapshot,
  StepId,
  StepPhase,
  ViewId,
} from '@openwizard/core'
import type { Mirror, MirrorResult } from '@openwizard/core/mirror'

/**
 * What `bindReact<T>()` accepts: a wizard (the source is a `Run`) or a projection (the source
 * is a `Mirror`).
 * @public
 */
export type BindTarget = AnyWizardDefinition | AnyProjection

/**
 * The wizard behind a bind target (the projection's wizard, or the wizard itself).
 * @public
 */
export type WizardOf<T extends BindTarget> = T extends AnyProjection
  ? ProjectionWizard<T>
  : T extends AnyWizardDefinition
    ? T
    : never

/**
 * The live object a binding's `Provider` takes: `Run<F>` for a wizard, `Mirror<P>` for a projection.
 * @public
 */
export type SourceOf<T extends BindTarget> = T extends AnyProjection
  ? Mirror<T>
  : T extends AnyWizardDefinition
    ? Run<T>
    : never

/**
 * The state the hooks read: `Snapshot<F>['state']` over a Run, `ProjectionOutput<P>`
 * (the projected `ClientState`) over a Mirror.
 * @public
 */
export type StateOf<T extends BindTarget> = T extends AnyProjection
  ? ProjectionOutput<T>
  : T extends AnyWizardDefinition
    ? Snapshot<T>['state']
    : never

/**
 * Result of the commands that are not navigation or `send`: `CommandResult` from a Run, a
 * `MirrorResult` (the ack's `CommandResult` or `TRANSPORT_FAILED`) from a Mirror.
 * @public
 */
export type CommandResultOf<T extends BindTarget> = T extends AnyProjection
  ? MirrorResult
  : CommandResult

/**
 * Result of the navigation actions: `NavResult` from a Run, a `MirrorResult` from a Mirror.
 * @public
 */
export type NavResultOf<T extends BindTarget> = T extends AnyProjection ? MirrorResult : NavResult

/**
 * Result of the `send` action: `SendResult` from a Run, a `MirrorResult` from a Mirror.
 * @public
 */
export type SendResultOf<T extends BindTarget> = T extends AnyProjection ? MirrorResult : SendResult

/**
 * The command methods of the source (`useActions()`) — the same sugar as `Run` / `Mirror`,
 * typed by the wizard; one stable object per source. `send` checks the payload against the
 * event's schema type (an `unknown` value is accepted and parsed by the event boundary).
 * @public
 */
export interface Actions<T extends BindTarget> {
  start(): Promise<CommandResultOf<T>>
  next(): Promise<NavResultOf<T>>
  back(): Promise<NavResultOf<T>>
  go(step: ViewId<WizardOf<T>>): Promise<NavResultOf<T>>
  setInput<K extends ViewId<WizardOf<T>>>(
    step: K,
    patch: DraftOf<WizardOf<T>, K>,
  ): Promise<CommandResultOf<T>>
  resetInput(step: ViewId<WizardOf<T>>): Promise<CommandResultOf<T>>
  send<E extends EventType<WizardOf<T>>, P>(
    event: E,
    payload: P & (unknown extends P ? unknown : PayloadInput<WizardOf<T>, E>),
    options?: SendOptions,
  ): Promise<SendResultOf<T>>
  startStep(step: RunStepId<WizardOf<T>>): Promise<CommandResultOf<T>>
  retry(
    step: RetryStepId<WizardOf<T>>,
    options?: { readonly patch?: Partial<Ctx<WizardOf<T>>> },
  ): Promise<CommandResultOf<T>>
  cancel(reason?: string): Promise<CommandResultOf<T>>
  startReady(): Promise<CommandResultOf<T>>
  compensate(options?: {
    readonly from?: StepId<WizardOf<T>>
    readonly reason?: string
  }): Promise<CommandResultOf<T>>
  reset(): Promise<CommandResultOf<T>>
  skip(step: StepId<WizardOf<T>>, reason?: string): Promise<CommandResultOf<T>>
  invalidate(
    step: StepId<WizardOf<T>>,
    options?: { readonly cascade?: boolean },
  ): Promise<CommandResultOf<T>>
  dispatch(command: Command<WizardOf<T>>): Promise<CommandResultOf<T>>
}

/**
 * `useActions()` over a Run: the commands plus the run's pure queries — `validate(view)`
 * (the view's issues over its current draft), `explain(step)` and `progress()`. Queries read
 * the run at call time; they do not subscribe the component.
 * @public
 */
export interface RunActions<F extends AnyWizardDefinition> extends Actions<F> {
  validate(step: ViewId<F>): Promise<readonly Issue[]>
  explain(step: StepId<F>): Explanation<F>
  progress(): Progress
}

/**
 * What `useActions()` returns: `RunActions` over a Run, `Actions` over a Mirror.
 * @public
 */
export type ActionsOf<T extends BindTarget> = T extends AnyProjection
  ? Actions<T>
  : RunActions<WizardOf<T>>

/**
 * The record of step `K` of a state slice `S` (a projected `ClientState` or a run state):
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
 * The record of step `K` as the hooks see it: the projected `ClientStepState` over a Mirror, the
 * `StepState` over a Run plus its live `phase` (`validating` while a view's `validate` hook
 * runs, `running`, `retrying`, `waiting`, …) — the same fact a projected record carries.
 * @public
 */
export type StepRecordOf<
  T extends BindTarget,
  K extends StepId<WizardOf<T>>,
> = T extends AnyProjection
  ? StepRecordIn<StateOf<T>, K>
  : StepRecordIn<StateOf<T>, K> & { readonly phase?: StepPhase }

/**
 * The field names of view `K`'s draft (what `issuesFor(field)` accepts).
 * @public
 */
export type FieldOf<F extends AnyWizardDefinition, K extends StepId<F>> = keyof NonNullable<
  DraftOf<F, K>
> &
  string

/**
 * `issuesFor(field)` lists a view's issues whose path starts at `field` (`issuesFor()`: the
 * issues without a path, e.g. a whole-object check). Offered only where record `R` carries
 * `issues`: always over a Run, over a projection for a view exposed with `issues: true`.
 * @internal
 */
export type IssuesFor<
  R,
  F extends AnyWizardDefinition,
  K extends StepId<F>,
> = 'issues' extends keyof R
  ? { readonly issuesFor: (field?: FieldOf<F, K>) => readonly Issue[] }
  : {}

/**
 * Helpers `useStep(id)` binds to a VIEW step (other steps get none): `next` / `back` navigate
 * from this view — when it is not the current view they resolve `{ ok: false, code:
 * 'NOT_ACTIVE' }` without sending anything —, `go` moves the cursor to it, `setInput` patches its
 * draft (`DraftOf`), `resetInput` restores it, and `issuesFor(field)` lists the issues whose
 * path starts at `field` (only where the record carries `issues`).
 * @public
 */
export type StepHelpers<T extends BindTarget, K extends StepId<WizardOf<T>>> =
  K extends ViewId<WizardOf<T>>
    ? {
        readonly next: () => Promise<NavResultOf<T>>
        readonly back: () => Promise<NavResultOf<T>>
        readonly go: () => Promise<NavResultOf<T>>
        readonly setInput: (patch: DraftOf<WizardOf<T>, K>) => Promise<CommandResultOf<T>>
        readonly resetInput: () => Promise<CommandResultOf<T>>
      } & IssuesFor<StepRecordOf<T, K>, WizardOf<T>, K>
    : {}

/**
 * What `useStep(id)` returns: the typed step record with the bound helpers spread in
 * (`const { status, phase, input, issuesFor, setInput, next } = ow.useStep('shipping')`).
 * @public
 */
export type UseStepResult<T extends BindTarget, K extends StepId<WizardOf<T>>> = StepRecordOf<
  T,
  K
> &
  StepHelpers<T, K>

/**
 * What `useCurrent()` returns: the record of the current view step, or `null`.
 * @public
 */
export type CurrentOf<T extends BindTarget> =
  | { [K in ViewId<WizardOf<T>>]: StepRecordOf<T, K> }[ViewId<WizardOf<T>>]
  | null
