/**
 * Typed views over the runtime state and events: `StepState` / `Snapshot`, the `RunEvent`
 * family (root vs child events) and `Explanation`.
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  Ctx,
  DraftOf,
  ErrorOf,
  EventType,
  FlowOutput,
  IsEach,
  KindOf,
  OutputOf,
  PayloadOf,
  RunStepId,
  StepId,
  ViewId,
} from '../../authoring/types'
import type { Explanation as MachineExplanation } from '../../machine'
import type { DomainEvent } from '../../machine/events'
import type { ChildSummary, StepError, StepRecord, WizardState } from '../../machine/state'
import type { WaitingFor } from '../results'
import type { Command } from './command'

/**
 * A step's stored error typed by the step: `SerializedError` (`name`, `message`, `code?`) plus
 * `kind`, `at`, `attempt?`, `issues?` and — for a runnable step with `mapError` — `data` (`ErrorOf<F, K>`).
 * @public
 */
export type StepErrorOf<F extends AnyFlow, K extends StepId<F>> = Omit<StepError, 'data'> & {
  readonly data?: ErrorOf<F, K>
}

/**
 * Typed view of one step's stored record: `input` is the draft (`DraftOf`), `output` the
 * step's `OutputOf`, `error` its `StepErrorOf` (with `data` for `mapError`); everything
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
 * The versioned, JSON-safe snapshot of a run (what `getSnapshot()` returns, what a `Store`
 * persists and what `wizard.resume` accepts). `state` is the typed view of the run state;
 * `children` hold the snapshots of live child flows keyed by flow-step id.
 * @public
 */
type SnapshotDefinition<Types extends AnyFlow['~types']> = Omit<AnyFlow, '~types'> & {
  readonly '~types': Types
}

/** Snapshot typing depends only on definition facts, so a wizard and its Flow have the same snapshot. @public */
export type Snapshot<F extends AnyFlow> = SnapshotFields<SnapshotDefinition<F['~types']>>

interface SnapshotFields<F extends AnyFlow> {
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

type StepOutputId<F extends AnyFlow> =
  string extends StepId<F> ? string : Exclude<StepId<F>, ViewId<F>>

type StepOutputEvent<
  T,
  F extends AnyFlow,
  K extends StepOutputId<F> = StepOutputId<F>,
> = K extends unknown
  ? Omit<T, 'step' | 'output'> & {
      readonly step: K
      readonly output?: OutputOf<F, K>
    }
  : never

type RunOutputEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown
  ? Omit<T, 'step' | 'output'> & {
      readonly step: K
      readonly output: OutputOf<F, K>
    }
  : never

type ViewOutputEvent<T, F extends AnyFlow, K extends ViewId<F> = ViewId<F>> = K extends unknown
  ? Omit<T, 'step' | 'output'> & {
      readonly step: K
      readonly output: OutputOf<F, K>
    }
  : never

type StepErrorEvent<T, F extends AnyFlow, K extends StepId<F> = StepId<F>> = K extends unknown
  ? Omit<T, 'step' | 'data'> & {
      readonly step: K
      readonly data?: ErrorOf<F, K>
    }
  : never

type RunErrorEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown
  ? Omit<T, 'step' | 'data'> & {
      readonly step: K
      readonly data?: ErrorOf<F, K>
    }
  : never

type RunStepEvent<T, F extends AnyFlow, K extends RunStepId<F> = RunStepId<F>> = K extends unknown
  ? Omit<T, 'step'> & { readonly step: K }
  : never

type FlowFailedEvent<T, F extends AnyFlow, K extends StepId<F> = StepId<F>> =
  | (K extends unknown
      ? Omit<T, 'step' | 'data'> & {
          readonly step: K
          readonly data?: ErrorOf<F, K>
        }
      : never)
  | (Omit<T, 'step'> & { readonly step?: never })

type EventPayloadEvent<
  T,
  F extends AnyFlow,
  Optional extends boolean,
  E extends EventType<F> = EventType<F>,
> = E extends unknown
  ? Omit<T, 'event' | 'payload'> & { readonly event: E } & (Optional extends true
        ? { readonly payload?: PayloadOf<F, E> }
        : { readonly payload: PayloadOf<F, E> })
  : never

type InputChangedEvent<T, F extends AnyFlow, K extends ViewId<F> = ViewId<F>> = K extends unknown
  ? Omit<T, 'step'> & { readonly step: K }
  : never

type ChildStartedEvent<
  T,
  F extends AnyFlow,
  P extends readonly string[],
  K extends ChildStepId<F> = ChildStepId<F>,
> = K extends unknown
  ? Omit<T, 'step' | 'childPath' | 'context'> & {
      readonly step: K
      readonly childPath: readonly [...P, K]
      readonly context: ContextInput<ChildFlowOf<F, K>>
    }
  : never

type ChildSummaryEvent<
  T,
  F extends AnyFlow,
  K extends ChildStepId<F> = ChildStepId<F>,
> = K extends unknown
  ? Omit<T, 'step' | 'done' | 'summary'> & {
      readonly step: K
      readonly summary: Omit<ChildSummary, 'current'> & {
        readonly current: ViewId<ChildFlowOf<F, K>> | null
      }
      readonly done?: { readonly output: FlowOutput<ChildFlowOf<F, K>> }
    }
  : never

type ChildCommandEvent<
  T,
  F extends AnyFlow,
  K extends ChildStepId<F> = ChildStepId<F>,
> = K extends unknown
  ? Omit<T, 'step' | 'command'> & {
      readonly step: K
      readonly command: Command<ChildFlowOf<F, K>>
    }
  : never

type TypedFlowEvent<T, F extends AnyFlow, P extends readonly string[]> = T extends {
  readonly type: 'flow.done'
}
  ? Omit<T, 'output'> & { readonly output?: FlowOutput<F> }
  : T extends { readonly type: 'flow.failed' }
    ? FlowFailedEvent<T, F>
    : T extends { readonly type: 'step.done' }
      ? StepOutputEvent<T, F>
      : T extends { readonly type: 'step.runSucceeded' }
        ? RunOutputEvent<T, F>
        : T extends { readonly type: 'step.validated' }
          ? ViewOutputEvent<T, F>
          : T extends { readonly type: 'step.failed' }
            ? StepErrorEvent<T, F>
            : T extends { readonly type: 'step.runFailed' }
              ? RunErrorEvent<T, F>
              : T extends {
                    readonly type:
                      | 'step.idempotencyKeyRequested'
                      | 'step.mapErrorStarted'
                      | 'step.retryScheduled'
                      | 'step.runStarted'
                  }
                ? RunStepEvent<T, F>
                : T extends { readonly type: 'input.changed' }
                  ? InputChangedEvent<T, F>
                  : T extends { readonly type: 'context.changed' }
                    ? Omit<T, 'patch'> & { readonly patch: Partial<Ctx<F>> }
                    : T extends {
                          readonly type:
                            | 'event.buffered'
                            | 'event.delivered'
                            | 'event.flowDelivered'
                            | 'event.received'
                        }
                      ? EventPayloadEvent<T, F, false>
                      : T extends { readonly type: 'child.started' }
                        ? ChildStartedEvent<T, F, P>
                        : T extends { readonly type: 'child.summary' }
                          ? ChildSummaryEvent<T, F>
                          : T extends { readonly type: 'child.command' }
                            ? ChildCommandEvent<T, F>
                            : T extends { readonly type: 'command.rejected' }
                              ? Omit<T, 'command'> & { readonly command: Command<F> }
                              : RetypeEvent<RetypeStep<T, F>, F>

type WithPath<T, P extends readonly string[]> = T extends unknown
  ? Omit<T, 'path'> & { readonly path: P }
  : never

type FlowEventAtPath<F extends AnyFlow, P extends readonly string[]> = WithPath<
  TypedFlowEvent<DomainEvent, F, P>,
  P
>

type RunEventDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
type PreviousRunEventDepth = [0, 0, 1, 2, 3, 4, 5, 6, 7]

type UntypedChildRunEvent<P extends readonly string[]> = WithPath<
  DomainEvent,
  readonly [...P, string, ...string[]]
>

type ChildPath<F extends AnyFlow, K extends ChildStepId<F>, P extends readonly string[]> =
  true extends IsEach<F, K> ? readonly [...P, K, `${number}`] : readonly [...P, K]

type ChildRunEventCandidates<
  F extends AnyFlow,
  P extends readonly string[],
  Depth extends RunEventDepth,
> = Depth extends 0
  ? never
  : string extends ChildStepId<F>
    ? UntypedChildRunEvent<P>
    : {
        [K in ChildStepId<F>]:
          | FlowEventAtPath<ChildFlowOf<F, K>, ChildPath<F, K, P>>
          | ChildRunEventAt<ChildFlowOf<F, K>, ChildPath<F, K, P>, PreviousRunEventDepth[Depth]>
      }[ChildStepId<F>]

type ChildRunEventAt<F extends AnyFlow, P extends readonly string[], Depth extends RunEventDepth> =
  ChildRunEventCandidates<F, P, Depth> extends infer Event extends DomainEvent ? Event : never

/**
 * A domain event of the run's OWN flow (`path` is `[]`), typed by the flow: `step` is a
 * `StepId<F>`, `event` an `EventType<F>`.
 * @public
 */
export type RootRunEvent<F extends AnyFlow = AnyFlow> = FlowEventAtPath<F, readonly []>

/**
 * A domain event forwarded from a child flow (`path.length > 0`). `path` identifies the child
 * flow that emitted it; step ids, event names and payloads come from that flow. Typing follows
 * nested flows to the runtime's maximum depth of eight. `AnyFlow` keeps string ids and unknown
 * payloads. Narrow a `RunEvent<F>` with `isChildEvent(event)`.
 * @public
 */
export type ChildRunEvent<F extends AnyFlow = AnyFlow> = ChildRunEventAt<F, readonly [], 8>

/**
 * A domain event of a run (`observe()` / `log()`): either an event of its own flow, typed by
 * `F` (`RootRunEvent<F>`, `path: []`), or one forwarded from a child flow
 * (`ChildRunEvent<F>`, `path: [step, …]`). TypeScript does not narrow on
 * `event.path.length`; use `isChildEvent(event)` to split the two.
 * @public
 */
export type RunEvent<F extends AnyFlow = AnyFlow> = RootRunEvent<F> | ChildRunEvent<F>

/** Name of any event emitted by an OpenWizard run. @public */
export type RunEventType = DomainEvent['type']

/**
 * True for events forwarded from a child flow (`event.path.length > 0`); narrows a
 * `RunEvent<F>` to `ChildRunEvent<F>` (and, in the other branch, to `RootRunEvent<F>`).
 * @public
 */
export function isChildEvent<F extends AnyFlow>(event: RunEvent<F>): event is ChildRunEvent<F> {
  return event.path.length > 0
}

/**
 * Result of `run.explain(step)`: the step's stored `status` (`'unknown'` for an unknown id),
 * its live `phase` (`undefined` when it has none), stable `reasons` codes explaining why it is
 * (not) where you expect (`flow-not-started`, `nav-busy`, `not-activated`, `deps-unmet:<id>`,
 * `guard-false:canEnter`, `concurrency-limit`, `auto-run-manual`, `failed:<kind>`,
 * `not-current`, `entering`, `retrying`, …), the ready views the cursor could move to, and
 * what the run waits on from the outside (`run.waitingFor()`).
 * @public
 */
export type Explanation<F extends AnyFlow = AnyFlow> = Omit<MachineExplanation, 'candidates'> & {
  readonly candidates: readonly ViewId<F>[]
  readonly waitingFor: readonly WaitingFor<F>[]
}
