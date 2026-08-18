/**
 * Mirror wire protocol (plan §8.9): the three JSON shapes that cross a transport.
 *
 * - `Frame<S>`: server → client. One full projected snapshot per committed batch, tagged
 *   with `(instanceId, epoch, seq)` so a Mirror can drop stale or duplicated frames.
 * - `WireCommand`: client → server. A `Command` wrapped with a `commandId` (correlation),
 *   the target `instanceId` and an optional `expectedSeq` (optimistic concurrency).
 * - `WireAck`: server → client. The `CommandResult` for one `commandId` and the seq the
 *   instance was at once the command was processed.
 *
 * `parseWireCommand(flow, input)` is the strict decoder for the client → server direction: exact
 * shape, nested `command` decoded with `parseCommand(flow, …)` (shape AND ids checked against
 * the flow, so `command` is a `Command<F>`). `parseFrame(input)` is the envelope check for the
 * server → client direction (the Mirror runs it on every frame; the projected `state` itself is
 * only checked to be an object — its shape is the projection's). Both accept plain objects only
 * and never throw. Nothing here touches the machine.
 *
 * @packageDocumentation
 */

import type { BoundaryResult } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import type { Issue } from '../machine/state'
import type { Command } from '../wizard/create-wizard'
import { parseCommand } from '../wizard/parse-command'
import type { CommandResult } from '../wizard/results'

/**
 * Server → client: one full projected snapshot (`state`) of instance `instanceId`, tagged with
 * `epoch` (increments on every resume) and `seq` (increments per applied event). A Mirror
 * applies a frame only when `(epoch, seq)` is newer than the last applied one.
 * @public
 */
export interface Frame<S> {
  readonly kind: 'snapshot'
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly state: S
}

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
const FRAME_ALLOWED = new Set(['kind', 'instanceId', 'epoch', 'seq', 'state'])
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
 * Strictly check an untrusted value as a `Frame` envelope: exact property allow-list,
 * `kind: 'snapshot'`, a non-empty `instanceId`, non-negative integer `epoch` / `seq`, and an
 * object `state` whose own `instanceId` / `epoch` / `seq` (the projection's base facts), when
 * present, match the envelope. The projected state's SHAPE is the projection's business and is
 * not checked here. `createMirror` runs it on every frame (invalid frames are ignored); hosts
 * that relay frames can run it themselves.
 * @public
 */
export function parseFrame(input: unknown): BoundaryResult<Frame<unknown>> {
  const issues: Issue[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: [{ message: 'frame must be an object', path: [] }] }
  }
  for (const key of Object.keys(input)) {
    if (!FRAME_ALLOWED.has(key)) {
      issues.push({ message: `unknown property '${key}' on frame`, path: [key] })
    }
  }
  if (input.kind !== 'snapshot') {
    issues.push({ message: "'kind' must be 'snapshot'", path: ['kind'] })
  }
  const instanceId = nonEmptyString(input, 'instanceId', issues)
  const epoch = nonNegativeInt(input, 'epoch', issues)
  const seq = nonNegativeInt(input, 'seq', issues)
  const state = input.state
  if (!isRecord(state)) {
    issues.push({ message: "'state' must be an object", path: ['state'] })
  } else {
    const facts: readonly ['instanceId' | 'epoch' | 'seq', unknown][] = [
      ['instanceId', instanceId],
      ['epoch', epoch],
      ['seq', seq],
    ]
    for (const [key, expected] of facts) {
      if (expected !== undefined && Object.hasOwn(state, key) && state[key] !== expected) {
        issues.push({ message: `'state.${key}' does not match the envelope`, path: ['state', key] })
      }
    }
  }
  if (issues.length > 0 || instanceId === undefined || epoch === undefined || seq === undefined) {
    return { ok: false, issues }
  }
  return { ok: true, value: { kind: 'snapshot', instanceId, epoch, seq, state } }
}

/** Plain objects only (`Object.prototype` or `null` prototype). */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
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
