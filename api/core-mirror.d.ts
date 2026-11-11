import { AnyFlow, AnyProjection, ChildFlowOf, ChildStepId, Command, CommandResult, Ctx, DraftOf, EventType, IsEach, PayloadInput, Projection, ProjectionDefinition, ProjectionFlow, ProjectionOutput, RetryStepId, Run, RunEvent, RunStepId, Snapshot, StepId, ViewId } from "@openwizard/core";
//#region src/mirror/commands.d.ts
/**
 * A Mirror command that never reached the server, or whose answer could not be trusted: the
 * transport rejected (`send` threw — offline, network error), answered with an ack for another
 * command or a malformed ack, or the Mirror has no transport.
 * @public
 */
interface TransportFailure {
  readonly ok: false;
  readonly code: 'TRANSPORT_FAILED';
  readonly message: string;
}
/**
 * What every Mirror command resolves with: the server's `CommandResult` (from the ack), or a
 * `TransportFailure`. Mirror commands never reject.
 * @public
 */
type MirrorResult = CommandResult | TransportFailure;
/**
 * The typed command sugar of a Mirror (and of a `MirrorChild`), typed by flow `F`: the same
 * methods as `Run`, each resolving with a `MirrorResult`; `dispatch` is the wire door;
 * `child(step)` scopes the same sugar to a nested flow.
 * @public
 */
interface MirrorCommands<F extends AnyFlow> {
  start(): Promise<MirrorResult>;
  next(): Promise<MirrorResult>;
  back(): Promise<MirrorResult>;
  go(step: ViewId<F>): Promise<MirrorResult>;
  /** Applied to the Mirror's state at once (optimistic draft), reconciled when the server's frame catches up. */
  setInput<K extends ViewId<F>>(step: K, patch: DraftOf<F, K>): Promise<MirrorResult>;
  resetInput(step: ViewId<F>): Promise<MirrorResult>;
  /**
   * The payload is checked against the event's schema input; an `unknown` body is accepted (the
   * server parses it). `eventId` dedupes deliveries on the server (`Run.send`).
   */
  send<E extends EventType<F>, P>(event: E, payload: unknown extends P ? P : PayloadInput<F, E>, options?: {
    readonly correlationId?: string;
    readonly eventId?: string;
  }): Promise<MirrorResult>;
  startStep(step: RunStepId<F>): Promise<MirrorResult>;
  retry(step: RetryStepId<F>, options?: {
    readonly patch?: Partial<Ctx<F>>;
  }): Promise<MirrorResult>;
  cancel(reason?: string): Promise<MirrorResult>;
  startReady(): Promise<MirrorResult>;
  compensate(options?: {
    readonly from?: StepId<F>;
    readonly reason?: string;
  }): Promise<MirrorResult>;
  reset(): Promise<MirrorResult>;
  /** Skip a ready or active step that does not complete the flow. */
  skip(step: StepId<F>, reason?: string): Promise<MirrorResult>;
  /** Return a done / failed / skipped step to `idle` (+ transitive dependents with `cascade`, default `true`). */
  invalidate(step: StepId<F>, options?: {
    readonly cascade?: boolean;
  }): Promise<MirrorResult>;
  /** The wire door: any `Command` of flow `F`, sent as-is (the server re-decodes it with `parseCommand`). */
  dispatch(command: Command<F>): Promise<MirrorResult>;
  /**
   * The same sugar scoped to the child flow of flow step `step`: every command travels as
   * `{ type: 'child', path, command }`. Mapped children require their input index; ordinary
   * children use only the step id. Nestable.
   */
  child<K extends ChildStepId<F>>(step: K, ...selector: true extends IsEach<F, K> ? [index: number] : [index?: never]): MirrorChild<Extract<ChildFlowOf<F, K>, AnyFlow>>;
}
/**
 * A scoped sender for a nested flow (`mirror.child(step)`, `.child(step).child(step2)`): the
 * `MirrorCommands` of the child flow, wrapped as `child` commands on `path`. It carries no
 * state of its own — read the child's projected state from `steps[step].child` of the mirror's
 * snapshot (exposed with `child: ExposeSpec`).
 * @public
 */
interface MirrorChild<F extends AnyFlow> extends MirrorCommands<F> {
  /** Path from the root run to this child (`['fulfil']`, `['batch', '0']`, `['fulfil', 'pack']`). */
  readonly path: readonly [string, ...string[]];
}
//#endregion
//#region src/interpreter/env.d.ts
interface IdGenerator {
  /** Unique id with a readable prefix (`tx`, `fx`, `evt`, `wiz`, ...). */
  id(prefix: string): string;
}
//#endregion
//#region src/machine/state-support.d.ts
/** Standard Schema v1 issue, kept structural so core has zero runtime deps. */
interface Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | {
    readonly key: PropertyKey;
  }>;
}
//#endregion
//#region src/authoring/compiled.d.ts
/** Result of parsing through a boundary. */
type BoundaryResult<T = unknown> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly issues: readonly Issue[];
};
//#endregion
//#region src/mirror/wire.d.ts
/**
 * Server → client: one full projected snapshot (`state`) of instance `instanceId`, tagged with
 * `epoch` (increments on every resume) and `seq` (increments per applied event). A Mirror
 * applies a frame only when `(epoch, seq)` is newer than the last applied one.
 * @public
 */
interface SnapshotFrame<S> {
  readonly kind: 'snapshot';
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  readonly state: S;
}
/**
 * The `step.progress` event a hook's `progress(value)` emits, typed by `F` (`step`, `path`): what
 * `run.observe()` and `mirror.observe()` deliver. Transient: never in the state, the snapshot or
 * the log.
 * @public
 */
type StepProgressEvent<F extends AnyFlow = AnyFlow> = Extract<RunEvent<F>, {
  readonly type: 'step.progress';
}>;
/**
 * Server → client: a transient `step.progress` event of instance `instanceId`, sent only when the
 * projection exposes progress. `seq` is the instance seq when it was reported; a Mirror hands
 * `event` to its `observe` listeners unless the frame is older than its applied state.
 * @public
 */
interface ProgressFrame {
  readonly kind: 'progress';
  readonly instanceId: string;
  readonly epoch: number;
  readonly seq: number;
  /** The `step.progress` event as `run.observe()` delivers it, with string ids on the wire. */
  readonly event: {
    readonly type: 'step.progress';
    readonly step: string;
    readonly value: unknown;
    readonly seq: number;
    readonly at: number;
    readonly path: readonly string[];
  };
}
/**
 * Server → client: a state snapshot or a transient progress event.
 * @public
 */
type Frame<S> = SnapshotFrame<S> | ProgressFrame;
/**
 * Client → server: a wire `Command` (JSON, decoded with `parseCommand` on the server) addressed
 * to one instance. `commandId` correlates the `WireAck`; `expectedSeq`, when present, makes the
 * server reject the command with `STALE` unless the instance is exactly at that seq. `command`
 * is a `Command<F>` (`Command<AnyFlow>`, i.e. string ids, until it is decoded for a flow).
 * @public
 */
interface WireCommand<F extends AnyFlow = AnyFlow> {
  readonly commandId: string;
  readonly instanceId: string;
  readonly expectedSeq?: number;
  readonly command: Command<F>;
}
/**
 * Server → client: the `CommandResult` of the command `commandId`, plus the instance `seq`
 * right after processing it (state itself arrives through frames, never through acks).
 * @public
 */
interface WireAck {
  readonly commandId: string;
  readonly result: CommandResult;
  readonly seq: number;
}
/**
 * Strictly decode an untrusted value into a `WireCommand<F>` for `flow`: exact property
 * allow-list, non-empty string ids, `expectedSeq` a non-negative integer when present, and the
 * nested `command` decoded with `parseCommand(flow, …)` (issues are prefixed with
 * `['command']`). The server half (`createMirrorSource().dispatch`) runs it on every input;
 * hosts can run it themselves before authorising the command.
 * @public
 */
declare function parseWireCommand<F extends AnyFlow>(flow: F, input: unknown): BoundaryResult<WireCommand<F>>;
/**
 * Strictly check an untrusted value as a `Frame`: exact property allow-list per `kind`, a
 * non-empty `instanceId` and non-negative integer `epoch` / `seq`. A `snapshot` frame needs a
 * `state` (any JSON value — a `select` projection may produce a primitive, an array or `null`)
 * whose own `instanceId` / `epoch` / `seq` (the projection's base facts), when it is an object
 * that carries them, match the envelope; its SHAPE is the projection's business. A `progress`
 * frame needs an exact `step.progress` event (`step`, `path`, `seq`, `at`, any JSON `value`).
 * `createMirror` runs it on every frame (invalid frames are ignored); hosts that relay frames
 * can run it themselves.
 * @public
 */
declare function parseFrame(input: unknown): BoundaryResult<Frame<unknown>>;
//#endregion
//#region src/mirror/transport.d.ts
/**
 * Client-side transport of the wire protocol: `subscribe` delivers frames (the server sends the
 * current snapshot frame on subscribe, then one per committed batch, interleaved with progress
 * frames) and calls `onClose` once when the
 * frame stream ends (network drop, server gone) — the Mirror then reports `connected: false`
 * until `mirror.connect()` subscribes again. `send` delivers a `WireCommand` and resolves with
 * its `WireAck`; a rejection (network failure) becomes a `TRANSPORT_FAILED` result on the
 * Mirror side.
 * @public
 */
interface Transport<S> {
  subscribe(onFrame: (frame: Frame<S>) => void, onClose?: (error?: unknown) => void): () => void;
  send(command: WireCommand): Promise<WireAck>;
}
//#endregion
//#region src/mirror/create-mirror.d.ts
/**
 * `createMirror` options: the `transport` (typed by the projected state; omit it for a static
 * Mirror — server rendering — and `connect(transport)` later), an `initial` frame (the one the
 * server rendered with, so the first client render has state), an optional id generator for
 * `commandId`s, `optimisticConcurrency` (send `expectedSeq` = the last applied seq with
 * every command, so a concurrent change answers `STALE`; default `false`) and
 * `onListenerError` (what a `subscribe`/`observe` listener throws, like the run option; default:
 * rethrown asynchronously).
 * @public
 */
interface MirrorOptions<P extends AnyProjection> {
  readonly transport?: Transport<ProjectionOutput<P>>;
  readonly initial?: SnapshotFrame<ProjectionOutput<P>>;
  readonly ids?: IdGenerator;
  readonly optimisticConcurrency?: boolean;
  readonly onListenerError?: (error: unknown) => void;
}
/**
 * Client-side replica of a run through projection `P`: read the projected state
 * (`getSnapshot`/`subscribe`), and send typed commands — the same sugar as `Run`
 * (`MirrorCommands`), each resolving with a `MirrorResult`. `instanceId/epoch/seq` mirror the
 * last applied frame (`null` before the first one).
 * @public
 */
interface Mirror<P extends AnyProjection> extends MirrorCommands<ProjectionFlow<P>> {
  /** Latest projected state with pending drafts merged in (stable identity per change), `null` before the first frame. */
  getSnapshot(): ProjectionOutput<P> | null;
  /** Notified after every applied frame, draft change, connection change and on `dispose`; a no-op after `dispose`. */
  subscribe(listener: () => void): () => void;
  /**
   * Transient events from the server, like `run.observe()`: the hook `progress(value)` of each
   * step a projection explicitly allows through its progress spec,
   * never part of the state. A no-op after `dispose`.
   */
  observe(listener: (event: StepProgressEvent<ProjectionFlow<P>>) => void): () => void;
  readonly instanceId: string | null;
  readonly epoch: number | null;
  readonly seq: number | null;
  /** True from the first frame of the current subscription until the transport closes, `connect()` or `dispose()`. */
  readonly connected: boolean;
  /** (Re)subscribe to `transport` (default: the current one) — reconnect without a new Mirror. State and drafts are kept. */
  connect(transport?: Transport<ProjectionOutput<P>>): void;
  /** Unsubscribe from the transport; later commands resolve `{ ok: false, code: 'DISPOSED' }`. */
  dispose(): void;
}
/**
 * Create a Mirror over `transport`. Subscribes immediately; the server sends the current frame
 * on subscribe, so `getSnapshot()` is non-null as soon as the transport delivers it (at once
 * with `initial`).
 * @public
 */
declare function createMirror<P extends AnyProjection>(options: MirrorOptions<P>): Mirror<P>;
//#endregion
//#region src/mirror/source.d.ts
/**
 * Server half of a Mirror: frames out, wire commands in. `S` is the projected state type of
 * the projection it was created with (`ClientState<F, E>` for an `expose` projection, the
 * mapper's return type for a `select` one).
 * @public
 */
interface MirrorSource<S> {
  /**
   * Sends the current snapshot frame immediately, then one per committed batch and a progress
   * frame per exposed `progress(value)`; `onClose` runs when the source is disposed (at once
   * when it already is — then nothing else happens).
   */
  subscribe(onFrame: (frame: Frame<S>) => void, onClose?: () => void): () => void;
  /** The current snapshot frame (what a server renders with and hands to `createMirror({ initial })`). */
  getFrame(): SnapshotFrame<S>;
  /**
   * Decode + gate a wire command and dispatch it. Never rejects for data problems: a bad
   * shape or an id unknown to the flow → `INVALID_COMMAND` (with issues), a foreign
   * `instanceId` → `INVALID_COMMAND`, an `expectedSeq` that is not the current seq → `STALE`,
   * a disposed run or source → `DISPOSED`; otherwise the run's own `CommandResult`. The
   * denied authorization returns `FORBIDDEN`. The ack's `seq` is the instance seq after
   * processing.
   */
  dispatch(command: WireCommand): Promise<WireAck>;
  /** Stop pushing frames, drop every subscriber and answer `DISPOSED` to later commands. Does not dispose the run. */
  dispose(): void;
}
/** Values passed to a Mirror source command authorization policy.
 * @public
 */
interface MirrorAuthorizationInput<F extends AnyFlow, Scope> {
  readonly state: Snapshot<F>['state'];
  readonly command: Command<F>;
  readonly scope: [Scope] extends [never] ? undefined : Scope;
}
/** Server-only principal and authorization policy for a Mirror source.
 * @public
 */
type MirrorSourceOptions<F extends AnyFlow, Scope = never> = {
  readonly authorize?: (input: MirrorAuthorizationInput<F, Scope>) => boolean | PromiseLike<boolean>;
  /** Reports subscriber failures without interrupting other subscribers. Default: rethrow asynchronously. */
  readonly onListenerError?: (error: unknown) => void;
} & ([Scope] extends [never] ? {
  readonly scope?: never;
} : {
  readonly scope: Scope;
});
/**
 * Create the server half of a Mirror for `run` seen through `projection`, which must be
 * defined for the same authored wizard. Provided variants share identity; a separately authored
 * definition throws `DEFINITION_INVALID`, same name or not.
 * A scoped projection requires `{ scope }`; the source parses and captures it once. `authorize`
 * may allow a command from `{ state, command, scope }`. Frames are cached per snapshot, so many
 * subscribers share one object.
 * @public
 */
declare function createMirrorSource<F extends AnyFlow, S, Scope = never>(run: Run<F>, projection: Projection<NoInfer<F>, S, Scope> | Projection<ProjectionDefinition<NoInfer<F>>, S, Scope>, ...optionsArg: [Scope] extends [never] ? [options?: MirrorSourceOptions<F, Scope>] : [options: MirrorSourceOptions<F, Scope>]): MirrorSource<S>;
//#endregion
export { type Frame, type Mirror, type MirrorAuthorizationInput, type MirrorChild, type MirrorCommands, type MirrorOptions, type MirrorResult, type MirrorSource, type MirrorSourceOptions, type ProgressFrame, type SnapshotFrame, type StepProgressEvent, type Transport, type TransportFailure, type WireAck, type WireCommand, createMirror, createMirrorSource, parseFrame, parseWireCommand };
//# sourceMappingURL=mirror.d.ts.map