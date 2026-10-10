/**
 * Typed views over the runtime state and events: `StepState` / `Snapshot`, the `WizardEvent`
 * family (root vs child events) and `Explanation`.
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  Ctx,
  DraftOf,
  ErrorOf,
  EventType,
  FlowOutput,
  KindOf,
  OutputOf,
  StepId,
  ViewId,
} from '../../authoring/types'
import type { Explanation as MachineExplanation } from '../../machine'
import type { DomainEvent } from '../../machine/events'
import type { StepError, StepRecord, WizardState } from '../../machine/state'

/**
 * A step's stored error typed by the step: `SerializedError` (`name`, `message`, `code?`) plus
 * `kind`, `at`, `attempt?`, `issues?` and — for a task with `mapError` — `data` (`ErrorOf<F, K>`).
 * @public
 */
export type StepErrorOf<F extends AnyFlow, K extends StepId<F>> = Omit<StepError, 'data'> & {
  readonly data?: ErrorOf<F, K>
}

/**
 * Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the
 * step's `OutputOf`, `error` its `StepErrorOf` (with `data` for a `mapError` task); everything
 * else (status, attempt, guards, timers…) is shared.
 * @public
 */
export type StepState<F extends AnyFlow, K extends StepId<F>> = Omit<
  StepRecord,
  'id' | 'kind' | 'input' | 'output' | 'error'
> & {
  readonly id: K
  readonly kind: KindOf<F, K>
  readonly input?: DraftOf<F, K>
  readonly output?: OutputOf<F, K>
  readonly error?: StepErrorOf<F, K>
}

/** Typed view of `WizardState`. */
type StateOf<F extends AnyFlow> = Omit<
  WizardState,
  'current' | 'active' | 'context' | 'steps' | 'history' | 'failedStep' | 'output'
> & {
  readonly current: ViewId<F> | null
  readonly active: readonly StepId<F>[]
  readonly context: Ctx<F>
  readonly steps: { readonly [K in StepId<F>]: StepState<F, K> }
  readonly history: readonly ViewId<F>[]
  readonly failedStep?: StepId<F>
  readonly output?: FlowOutput<F>
}

/**
 * The versioned, JSON-safe snapshot of a wizard (what `getSnapshot()` returns, what a `Store`
 * persists and what `resumeWizard` accepts). `state` is the typed view of the wizard state;
 * `children` hold the snapshots of live child flows keyed by flow-step id.
 * @public
 */
export interface Snapshot<F extends AnyFlow> {
  readonly v: 1
  readonly flow: { readonly name: string; readonly version: number }
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly savedAt: number
  readonly state: StateOf<F>
  readonly children: { readonly [K in ChildStepId<F>]?: Snapshot<ChildFlowOf<F, K>> }
}

type RetypeStep<T, F extends AnyFlow> = T extends { readonly step: string }
  ? Omit<T, 'step'> & { readonly step: StepId<F> }
  : 'step' extends keyof T
    ? Omit<T, 'step'> & { readonly step?: StepId<F> }
    : T
type RetypeEvent<T, F extends AnyFlow> = T extends { readonly event: string }
  ? Omit<T, 'event'> & { readonly event: EventType<F> }
  : T
type WithPath<T, P extends readonly string[]> = T extends unknown
  ? Omit<T, 'path'> & { readonly path: P }
  : never

/**
 * A domain event of the wizard's OWN flow (`path` is `[]`), typed by the flow: `step` is a
 * `StepId<F>`, `event` an `EventType<F>`.
 * @public
 */
export type RootWizardEvent<F extends AnyFlow = AnyFlow> = WithPath<
  RetypeEvent<RetypeStep<DomainEvent, F>, F>,
  readonly []
>

/**
 * A domain event forwarded from a child flow (`path.length > 0`, the child's wizard path): step
 * ids and event names are the child's, typed as `string`. Narrow with `isChildEvent(event)`.
 * @public
 */
export type ChildWizardEvent = WithPath<DomainEvent, readonly [string, ...string[]]>

/**
 * A domain event of a wizard (`observe()` / `log()`): either an event of its own flow, typed by
 * `F` (`RootWizardEvent<F>`, `path: []`), or one forwarded from a child flow
 * (`ChildWizardEvent`, `path: [step, …]`, ids as `string`). TypeScript does not narrow on
 * `event.path.length`; use `isChildEvent(event)` to split the two.
 * @public
 */
export type WizardEvent<F extends AnyFlow = AnyFlow> = RootWizardEvent<F> | ChildWizardEvent

/**
 * True for events forwarded from a child flow (`event.path.length > 0`); narrows a
 * `WizardEvent<F>` to `ChildWizardEvent` (and, in the other branch, to `RootWizardEvent<F>`).
 * @public
 */
export function isChildEvent(event: WizardEvent): event is ChildWizardEvent {
  return event.path.length > 0
}

/**
 * Result of `wizard.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id),
 * its live `phase` (`undefined` when it has none), stable `reasons` codes explaining why it is
 * (not) where you expect (`flow-not-started`, `nav-busy`, `not-activated`, `deps-unmet:<id>`,
 * `guard-false:canEnter`, `concurrency-limit`, `auto-run-manual`, `failed:<kind>`,
 * `not-current`, `entering`, `retrying`, …) and the ready views the cursor could move to.
 * @public
 */
export type Explanation<F extends AnyFlow = AnyFlow> = Omit<MachineExplanation, 'candidates'> & {
  readonly candidates: readonly ViewId<F>[]
}
