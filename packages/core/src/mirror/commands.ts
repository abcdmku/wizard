/**
 * The typed command sugar of a Mirror (`MirrorCommands`) and of a nested flow (`MirrorChild`),
 * plus the untyped builder both share: every method becomes one `Command` handed to a
 * `dispatch` (a child's wrapped as `{ type: 'child', path, command }`).
 *
 * @packageDocumentation
 */

import type {
  AnyFlow,
  ChildFlowOf,
  ChildStepId,
  Command,
  CommandResult,
  Ctx,
  DraftOf,
  EventType,
  IsEach,
  PayloadInput,
  RetryStepId,
  RunStepId,
  StepId,
  ViewId,
} from '@openwizard/core'
import { WizardError } from '../errors'

/**
 * A Mirror command that never reached the server, or whose answer could not be trusted: the
 * transport rejected (`send` threw — offline, network error), answered with an ack for another
 * command or a malformed ack, or the Mirror has no transport.
 * @public
 */
export interface TransportFailure {
  readonly ok: false
  readonly code: 'TRANSPORT_FAILED'
  readonly message: string
}

/**
 * What every Mirror command resolves with: the server's `CommandResult` (from the ack), or a
 * `TransportFailure`. Mirror commands never reject.
 * @public
 */
export type MirrorResult = CommandResult | TransportFailure

/**
 * The typed command sugar of a Mirror (and of a `MirrorChild`), typed by flow `F`: the same
 * methods as `Run`, each resolving with a `MirrorResult`; `dispatch` is the wire door;
 * `child(step)` scopes the same sugar to a nested flow.
 * @public
 */
export interface MirrorCommands<F extends AnyFlow> {
  start(): Promise<MirrorResult>
  next(): Promise<MirrorResult>
  back(): Promise<MirrorResult>
  go(step: ViewId<F>): Promise<MirrorResult>
  /** Applied to the Mirror's state at once (optimistic draft), reconciled when the server's frame catches up. */
  setInput<K extends ViewId<F>>(step: K, patch: DraftOf<F, K>): Promise<MirrorResult>
  resetInput(step: ViewId<F>): Promise<MirrorResult>
  /**
   * The payload is checked against the event's schema input; an `unknown` body is accepted (the
   * server parses it). `eventId` dedupes deliveries on the server (`Run.send`).
   */
  send<E extends EventType<F>, P>(
    event: E,
    payload: unknown extends P ? P : PayloadInput<F, E>,
    options?: { readonly correlationId?: string; readonly eventId?: string },
  ): Promise<MirrorResult>
  startStep(step: RunStepId<F>): Promise<MirrorResult>
  retry(step: RetryStepId<F>, options?: { readonly patch?: Partial<Ctx<F>> }): Promise<MirrorResult>
  cancel(reason?: string): Promise<MirrorResult>
  startReady(): Promise<MirrorResult>
  compensate(options?: {
    readonly from?: StepId<F>
    readonly reason?: string
  }): Promise<MirrorResult>
  reset(): Promise<MirrorResult>
  /** Skip a ready or active step that does not complete the flow. */
  skip(step: StepId<F>, reason?: string): Promise<MirrorResult>
  /** Return a done / failed / skipped step to `idle` (+ transitive dependents with `cascade`, default `true`). */
  invalidate(step: StepId<F>, options?: { readonly cascade?: boolean }): Promise<MirrorResult>
  /** The wire door: any `Command` of flow `F`, sent as-is (the server re-decodes it with `parseCommand`). */
  dispatch(command: Command<F>): Promise<MirrorResult>
  /**
   * The same sugar scoped to the child flow of flow step `step`: every command travels as
   * `{ type: 'child', path, command }`. Mapped children require their input index; ordinary
   * children use only the step id. Nestable.
   */
  child<K extends ChildStepId<F>>(
    step: K,
    ...selector: true extends IsEach<F, K> ? [index: number] : [index?: never]
  ): MirrorChild<Extract<ChildFlowOf<F, K>, AnyFlow>>
}

/**
 * A scoped sender for a nested flow (`mirror.child(step)`, `.child(step).child(step2)`): the
 * `MirrorCommands` of the child flow, wrapped as `child` commands on `path`. It carries no
 * state of its own — read the child's projected state from `steps[step].child` of the mirror's
 * snapshot (exposed with `child: ExposeSpec`).
 * @public
 */
export interface MirrorChild<F extends AnyFlow> extends MirrorCommands<F> {
  /** Path from the root run to this child (`['fulfil']`, `['batch', '0']`, `['fulfil', 'pack']`). */
  readonly path: readonly [string, ...string[]]
}

type Dispatch = (command: Command) => Promise<MirrorResult>

/**
 * The untyped command sugar over a `dispatch`, for the root (`path: []`) and for children: a
 * child's commands are wrapped as `{ type: 'child', path, command }` (flattened path — the
 * server walks it segment by segment). The public interfaces narrow the ids to the flow.
 */
export function commandSugar<F extends AnyFlow>(
  dispatch: Dispatch,
  path: readonly string[],
): MirrorCommands<F> {
  const [head, ...rest] = path
  const send: Dispatch = (command) =>
    head === undefined
      ? dispatch(command)
      : dispatch({ type: 'child', path: [head, ...rest], command })
  return {
    start: () => send({ type: 'start' }),
    next: () => send({ type: 'next' }),
    back: () => send({ type: 'back' }),
    go: (step) => send({ type: 'go', step }),
    setInput: (step, patch) => send({ type: 'setInput', step, patch }),
    resetInput: (step) => send({ type: 'resetInput', step }),
    send: (event, payload, options) =>
      send({
        type: 'send',
        event,
        payload,
        ...(options?.correlationId === undefined ? {} : { correlationId: options.correlationId }),
        ...(options?.eventId === undefined ? {} : { eventId: options.eventId }),
      }),
    startStep: (step) => send({ type: 'startStep', step }),
    retry: (step, options) =>
      send(
        options?.patch === undefined
          ? { type: 'retry', step }
          : { type: 'retry', step, patch: options.patch },
      ),
    cancel: (reason) =>
      send(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
    startReady: () => send({ type: 'startReady' }),
    compensate: (options) =>
      send({
        type: 'compensate',
        ...(options?.from === undefined ? {} : { from: options.from }),
        ...(options?.reason === undefined ? {} : { reason: options.reason }),
      }),
    reset: () => send({ type: 'reset' }),
    skip: (step, reason) =>
      send(reason === undefined ? { type: 'skip', step } : { type: 'skip', step, reason }),
    invalidate: (step, options) =>
      send(
        options?.cascade === undefined
          ? { type: 'invalidate', step }
          : { type: 'invalidate', step, cascade: options.cascade },
      ),
    dispatch: send,
    child: <K extends ChildStepId<F>>(
      step: K,
      ...selector: true extends IsEach<F, K> ? [index: number] : [index?: never]
    ) => {
      const index = selector[0]
      return childSender<Extract<ChildFlowOf<F, K>, AnyFlow>>(
        dispatch,
        index === undefined ? [...path, step] : [...path, step, String(index)],
      )
    },
  }
}

function childSender<F extends AnyFlow>(
  dispatch: Dispatch,
  segments: readonly string[],
): MirrorChild<F> {
  const [head, ...rest] = segments
  if (head === undefined) throw new WizardError('INVALID_COMMAND', 'child path must not be empty')
  const path: readonly [string, ...string[]] = [head, ...rest]
  return { path, ...commandSugar<F>(dispatch, path) }
}
