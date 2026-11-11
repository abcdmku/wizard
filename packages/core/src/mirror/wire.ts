/**
 * Mirror wire protocol (plan §8.9): the three JSON shapes that cross a transport.
 *
 * - `Frame<S>`: server → client. A `SnapshotFrame<S>` (one full projected snapshot per committed
 *   batch) or a `ProgressFrame` (a hook's transient `progress(value)`, never part of the state),
 *   both tagged with `(instanceId, epoch, seq)` so a Mirror can drop stale or duplicated frames.
 * - `WireCommand`: client → server. A `Command` wrapped with a `commandId` (correlation),
 *   the target `instanceId` and an optional `expectedSeq` (optimistic concurrency).
 * - `WireAck`: server → client. The `CommandResult` for one `commandId` and the seq the
 *   instance was at once the command was processed.
 *
 * `parseWireCommand(flow, input)` is the strict decoder for the client → server direction: exact
 * shape, nested `command` decoded with `parseCommand(flow, …)` (shape AND ids checked against
 * the flow, so `command` is a `Command<F>`). `parseFrame(input)` is the envelope check for the
 * server → client direction (the Mirror runs it on every frame; the projected `state` and a
 * progress `value` may be any JSON value). Both accept plain objects only and never throw.
 * Nothing here touches the machine.
 *
 * @packageDocumentation
 */

import type { AnyFlow, Command, CommandResult, Issue, RunEvent } from '@openwizard/core'
import type { BoundaryResult } from '../authoring/compiled'
import { isPlainObject as isRecord } from '../machine/util'
import { parseCommand } from '../wizard/parse-command'
import { isNonNegativeInt } from '../wizard/snapshot-checks'

/**
 * Server → client: one full projected snapshot (`state`) of instance `instanceId`, tagged with
 * `epoch` (increments on every resume) and `seq` (increments per applied event). A Mirror
 * applies a frame only when `(epoch, seq)` is newer than the last applied one.
 * @public
 */
export interface SnapshotFrame<S> {
  readonly kind: 'snapshot'
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly state: S
}

/**
 * The `step.progress` event a hook's `progress(value)` emits, typed by `F` (`step`, `path`): what
 * `run.observe()` and `mirror.observe()` deliver. Transient: never in the state, the snapshot or
 * the log.
 * @public
 */
export type StepProgressEvent<F extends AnyFlow = AnyFlow> = Extract<
  RunEvent<F>,
  { readonly type: 'step.progress' }
>

/**
 * Server → client: a transient `step.progress` event of instance `instanceId`, sent only when the
 * projection exposes progress. `seq` is the instance seq when it was reported; a Mirror hands
 * `event` to its `observe` listeners unless the frame is older than its applied state.
 * @public
 */
export interface ProgressFrame {
  readonly kind: 'progress'
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  /** The `step.progress` event as `run.observe()` delivers it, with string ids on the wire. */
  readonly event: {
    readonly type: 'step.progress'
    readonly step: string
    readonly value: unknown
    readonly seq: number
    readonly at: number
    readonly path: readonly string[]
  }
}

/**
 * Server → client: a state snapshot or a transient progress event.
 * @public
 */
export type Frame<S> = SnapshotFrame<S> | ProgressFrame

/**
 * Client → server: a wire `Command` (JSON, decoded with `parseCommand` on the server) addressed
 * to one instance. `commandId` correlates the `WireAck`; `expectedSeq`, when present, makes the
 * server reject the command with `STALE` unless the instance is exactly at that seq. `command`
 * is a `Command<F>` (`Command<AnyFlow>`, i.e. string ids, until it is decoded for a flow).
 * @public
 */
export interface WireCommand<F extends AnyFlow = AnyFlow> {
  readonly commandId: string
  readonly instanceId: string
  readonly expectedSeq?: number
  readonly command: Command<F>
}

/**
 * Server → client: the `CommandResult` of the command `commandId`, plus the instance `seq`
 * right after processing it (state itself arrives through frames, never through acks).
 * @public
 */
export interface WireAck {
  readonly commandId: string
  readonly result: CommandResult
  readonly seq: number
}

const ALLOWED = new Set(['commandId', 'instanceId', 'expectedSeq', 'command'])
const SNAPSHOT_ALLOWED = new Set(['kind', 'instanceId', 'epoch', 'seq', 'state'])
const PROGRESS_ALLOWED = new Set(['kind', 'instanceId', 'epoch', 'seq', 'event'])
const PROGRESS_EVENT_ALLOWED = new Set(['type', 'step', 'value', 'seq', 'at', 'path'])
/** Longest accepted id string. */
const MAX_STRING = 65_536

/**
 * Strictly decode an untrusted value into a `WireCommand<F>` for `flow`: exact property
 * allow-list, non-empty string ids, `expectedSeq` a non-negative integer when present, and the
 * nested `command` decoded with `parseCommand(flow, …)` (issues are prefixed with
 * `['command']`). The server half (`createMirrorSource().dispatch`) runs it on every input;
 * hosts can run it themselves before authorising the command.
 * @public
 */
export function parseWireCommand<F extends AnyFlow>(
  flow: F,
  input: unknown,
): BoundaryResult<WireCommand<F>> {
  const issues: Issue[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: [{ message: 'wire command must be an object', path: [] }] }
  }
  const record = input
  for (const key of Object.keys(record)) {
    if (!ALLOWED.has(key)) {
      issues.push({ message: `unknown property '${key}' on wire command`, path: [key] })
    }
  }
  const commandId = nonEmptyString(record, 'commandId', issues)
  const instanceId = nonEmptyString(record, 'instanceId', issues)
  let expectedSeq: number | undefined
  if (Object.hasOwn(record, 'expectedSeq')) {
    const value = record.expectedSeq
    if (!isNonNegativeInt(value)) {
      issues.push({
        message: "'expectedSeq' must be a non-negative integer",
        path: ['expectedSeq'],
      })
    } else {
      expectedSeq = value
    }
  }
  let command: Command<F> | undefined
  if (!Object.hasOwn(record, 'command')) {
    issues.push({ message: "'command' is required", path: ['command'] })
  } else {
    const parsed = parseCommand(flow, record.command)
    if (parsed.ok) {
      command = parsed.value
    } else {
      for (const issue of parsed.issues) {
        issues.push({ message: issue.message, path: ['command', ...(issue.path ?? [])] })
      }
    }
  }
  if (
    issues.length > 0 ||
    commandId === undefined ||
    instanceId === undefined ||
    command === undefined
  ) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: {
      commandId,
      instanceId,
      ...(expectedSeq === undefined ? {} : { expectedSeq }),
      command,
    } as WireCommand<F>,
  }
}

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
export function parseFrame(input: unknown): BoundaryResult<Frame<unknown>> {
  const issues: Issue[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: [{ message: 'frame must be an object', path: [] }] }
  }
  const progress = input.kind === 'progress'
  for (const key of Object.keys(input)) {
    if (!(progress ? PROGRESS_ALLOWED : SNAPSHOT_ALLOWED).has(key)) {
      issues.push({ message: `unknown property '${key}' on frame`, path: [key] })
    }
  }
  if (!progress && input.kind !== 'snapshot') {
    issues.push({ message: "'kind' must be 'snapshot' or 'progress'", path: ['kind'] })
  }
  const instanceId = nonEmptyString(input, 'instanceId', issues)
  const epoch = nonNegativeInt(input, 'epoch', issues)
  const seq = nonNegativeInt(input, 'seq', issues)
  const event = progress ? progressEvent(input.event, issues) : undefined
  if (!progress) checkState(input, { instanceId, epoch, seq }, issues)
  if (issues.length > 0 || instanceId === undefined || epoch === undefined || seq === undefined) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value:
      event === undefined
        ? { kind: 'snapshot', instanceId, epoch, seq, state: input.state }
        : { kind: 'progress', instanceId, epoch, seq, event },
  }
}

/** A snapshot frame's `state` is required; its base facts, when it carries them, match the envelope. */
function checkState(
  frame: Record<string, unknown>,
  envelope: {
    readonly instanceId: string | undefined
    readonly epoch: number | undefined
    readonly seq: number | undefined
  },
  issues: Issue[],
): void {
  if (!Object.hasOwn(frame, 'state')) {
    issues.push({ message: "'state' is required", path: ['state'] })
    return
  }
  // Any JSON value is a valid projected state (a `select` projection may return a primitive,
  // an array or `null`); the base facts are cross-checked only when the state carries them.
  const state = frame.state
  if (!isRecord(state)) return
  for (const key of ['instanceId', 'epoch', 'seq'] as const) {
    const expected = envelope[key]
    if (expected !== undefined && Object.hasOwn(state, key) && state[key] !== expected) {
      issues.push({ message: `'state.${key}' does not match the envelope`, path: ['state', key] })
    }
  }
}

/** Decode a progress frame's `event`: an exact `step.progress` event (issues under `['event']`). */
function progressEvent(input: unknown, issues: Issue[]): ProgressFrame['event'] | undefined {
  if (!isRecord(input)) {
    issues.push({ message: "'event' must be an object", path: ['event'] })
    return undefined
  }
  const inner: Issue[] = []
  for (const key of Object.keys(input)) {
    if (!PROGRESS_EVENT_ALLOWED.has(key)) {
      inner.push({ message: `unknown property '${key}' on progress event`, path: [key] })
    }
  }
  if (input.type !== 'step.progress') {
    inner.push({ message: "'type' must be 'step.progress'", path: ['type'] })
  }
  const step = nonEmptyString(input, 'step', inner)
  const seq = nonNegativeInt(input, 'seq', inner)
  const { at, path, value } = input
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    inner.push({ message: "'at' must be a finite number", path: ['at'] })
  }
  const ids = isPath(path) ? [...path] : undefined
  if (ids === undefined) {
    inner.push({ message: "'path' must be an array of non-empty strings", path: ['path'] })
  }
  if (!Object.hasOwn(input, 'value')) {
    inner.push({ message: "'value' is required", path: ['value'] })
  }
  for (const issue of inner) {
    issues.push({ message: issue.message, path: ['event', ...(issue.path ?? [])] })
  }
  if (
    inner.length > 0 ||
    step === undefined ||
    seq === undefined ||
    ids === undefined ||
    typeof at !== 'number'
  ) {
    return undefined
  }
  return { type: 'step.progress', step, value, seq, at, path: ids }
}

function isPath(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_STRING)
  )
}

function nonNegativeInt(
  record: Record<string, unknown>,
  key: string,
  issues: Issue[],
): number | undefined {
  const value = record[key]
  if (isNonNegativeInt(value)) return value
  issues.push({ message: `'${key}' must be a non-negative integer`, path: [key] })
  return undefined
}

function nonEmptyString(
  record: Record<string, unknown>,
  key: string,
  issues: Issue[],
): string | undefined {
  const value = record[key]
  if (typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING) return value
  issues.push({
    message:
      typeof value === 'string' && value.length > MAX_STRING
        ? `'${key}' must be at most ${MAX_STRING} characters`
        : `'${key}' must be a non-empty string`,
    path: [key],
  })
  return undefined
}
