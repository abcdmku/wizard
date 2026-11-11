/**
 * Strict decoder for wire commands (plan §8.9): JSON arrives from a transport
 * as `unknown`; `parseCommand(flow, input)` checks the exact shape — allow-listed
 * fields per command type (unknown properties are rejected, not dropped),
 * JSON-value payloads (`patch` / `payload` must survive `JSON.stringify`
 * unchanged), no internal commands (`sendRejected` is façade-only) — AND that
 * every id exists in the compiled flow (`go` / `setInput` / `resetInput` name a
 * view, `run` / `retry` a runnable step (`retry.patch` a JSON object), `send` a declared event
 * (`send.eventId` a dedupe id), `compensate.from` /
 * `skip.step` / `invalidate.step` a step (v0.2; `invalidate.cascade` a boolean),
 * every `child` path segment a flow step, the nested command checked
 * against the child flow it reaches). It returns a fresh `Command<F>` or
 * Standard-Schema style issues, so `run.dispatch(parsed.value)` typechecks.
 * The *effective* child path depth (all segments across the nesting) is capped
 * at 8. `decodeCommand` (internal) is the shape-only half the runtime uses.
 *
 * Hardened for untrusted input: every object must be a plain object (`Object.prototype` or
 * `null` prototype — inherited properties are never read), lookups use `Object.hasOwn`,
 * strings are capped at 64 KiB, and JSON payloads are walked iteratively with limits (depth
 * ≤ 64, ≤ 10 000 values), so no input can throw out of the decoder.
 *
 * @packageDocumentation
 */

import { compile } from '../authoring/compile'
import type { BoundaryResult, CompiledFlow } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import type { Command } from '../machine/commands'
import type { Issue } from '../machine/state'
import { isPlainObject as isRecord } from '../machine/util'
import { resolveCommandPath } from './command-path'
import type { Command as TypedCommand } from './create-wizard'
import { firstNonJson, type JsonCheckOptions } from './json'

const MAX_PATH_DEPTH = 8
/** Longest accepted string (ids, reasons, and every string inside a JSON payload). */
const MAX_STRING = 65_536
/** Payload limits (`setInput.patch`, `send.payload`). */
const PAYLOAD_LIMITS: JsonCheckOptions = {
  maxDepth: 64,
  maxNodes: 10_000,
  maxStringLength: MAX_STRING,
}

/** Allowed properties per command type (`type` is implicit); `!` marks required ones. */
const SHAPES: Readonly<Record<string, readonly string[]>> = {
  start: [],
  next: [],
  back: [],
  startReady: [],
  reset: [],
  go: ['step!', 'reason'],
  setInput: ['step!', 'patch!'],
  resetInput: ['step!'],
  startStep: ['step!'],
  retry: ['step!', 'patch'],
  send: ['event!', 'payload!', 'correlationId', 'eventId'],
  cancel: ['reason'],
  compensate: ['from', 'reason'],
  skip: ['step!', 'reason'],
  invalidate: ['step!', 'cascade'],
  child: ['path!', 'command!'],
}

/**
 * Strictly decode an untrusted wire value into a `Command<F>` of `flow`: exact per-type field
 * allow-lists, JSON-only payloads, child path depth ≤ 8, and every step id / event name checked
 * against the flow (unknown → issues). Use it before `dispatch()` on anything from a transport.
 *
 * @public
 */
export function parseCommand<F extends AnyFlow>(
  flow: F,
  input: unknown,
): BoundaryResult<TypedCommand<F>> {
  const decoded = decodeCommand(input, compile(flow))
  return decoded.ok ? { ok: true, value: decoded.value as TypedCommand<F> } : decoded
}

/**
 * @internal Shape-only decoding (plus id checks when `def` is given): what the runtime's
 * `dispatch()` runs on every input.
 */
export function decodeCommand(
  input: unknown,
  def?: CompiledFlow,
  checkIds = true,
): BoundaryResult<Command> {
  const issues: Issue[] = []
  const command = parse(input, [], 0, issues, def, checkIds)
  return command === undefined || issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: command }
}

function parse(
  input: unknown,
  path: readonly PropertyKey[],
  depth: number,
  issues: Issue[],
  def: CompiledFlow | undefined,
  checkIds: boolean,
): Command | undefined {
  if (!isRecord(input)) {
    issues.push({ message: 'command must be an object', path })
    return undefined
  }
  const start = issues.length
  const type = input.type
  if (typeof type !== 'string') {
    issues.push({ message: "command must have a string 'type'", path: [...path, 'type'] })
    return undefined
  }
  if (type === 'sendRejected') {
    issues.push({
      message: "'sendRejected' is internal and cannot be dispatched",
      path: [...path, 'type'],
    })
    return undefined
  }
  const shape = Object.hasOwn(SHAPES, type) ? SHAPES[type] : undefined
  if (shape === undefined) {
    issues.push({ message: `unknown command type '${type}'`, path: [...path, 'type'] })
    return undefined
  }

  // Exact field allow-list.
  const allowed = new Set(shape.map((f) => f.replace(/!$/, '')))
  for (const key of Object.keys(input)) {
    if (key !== 'type' && !allowed.has(key)) {
      issues.push({ message: `unknown property '${key}' on '${type}'`, path: [...path, key] })
    }
  }
  for (const field of shape) {
    if (field.endsWith('!') && !Object.hasOwn(input, field.slice(0, -1))) {
      issues.push({
        message: `'${field.slice(0, -1)}' is required`,
        path: [...path, field.slice(0, -1)],
      })
    }
  }
  if (issues.length > start) return undefined

  const str = (key: string): string | undefined => {
    const value = input[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.length === 0) {
      issues.push({ message: `'${key}' must be a non-empty string`, path: [...path, key] })
      return undefined
    }
    if (value.length > MAX_STRING) {
      issues.push({
        message: `'${key}' must be at most ${MAX_STRING} characters`,
        path: [...path, key],
      })
      return undefined
    }
    return value
  }
  const json = (key: string): boolean => {
    const bad = firstNonJson(input[key], PAYLOAD_LIMITS)
    if (bad === undefined) return true
    issues.push({
      message: `'${key}' must be a JSON value (value${bad.path} ${bad.problem})`,
      path: [...path, key],
    })
    return false
  }
  /** Flow checks (only with a `def`): the id must name a step of the given kind. */
  const stepOfKind = (
    key: string,
    id: string | undefined,
    kind: 'view' | 'runnable' | 'retryable' | 'any',
  ): boolean => {
    if (!checkIds || def === undefined || id === undefined) return true
    const found = Object.hasOwn(def.steps, id) ? def.steps[id] : undefined
    if (found === undefined) {
      issues.push({ message: `unknown step '${id}'`, path: [...path, key] })
      return false
    }
    const matches =
      kind === 'any' ||
      found.kind === kind ||
      (kind === 'runnable' && found.hooks.run !== undefined) ||
      (kind === 'retryable' && (found.hooks.run !== undefined || found.each !== undefined))
    if (!matches) {
      issues.push({ message: `'${id}' is not a ${kind} step`, path: [...path, key] })
      return false
    }
    return true
  }

  switch (type) {
    case 'start':
    case 'next':
    case 'back':
    case 'startReady':
    case 'reset':
      return { type }
    case 'go': {
      const step = str('step')
      const reason = str('reason')
      if (!stepOfKind('step', step, 'view')) return undefined
      if (issues.length > start || step === undefined) return undefined
      return reason === undefined ? { type, step } : { type, step, reason }
    }
    case 'setInput': {
      const step = str('step')
      const ok = json('patch')
      if (!stepOfKind('step', step, 'view')) return undefined
      if (issues.length > start || step === undefined || !ok) return undefined
      return { type, step, patch: input.patch }
    }
    case 'resetInput':
    case 'startStep': {
      const step = str('step')
      if (!stepOfKind('step', step, type === 'resetInput' ? 'view' : 'runnable')) return undefined
      return step === undefined ? undefined : { type, step }
    }
    case 'retry': {
      const step = str('step')
      const patch = input.patch
      if (patch !== undefined && !isRecord(patch))
        issues.push({ message: "'patch' must be an object", path: [...path, 'patch'] })
      const ok = patch === undefined || json('patch')
      if (!stepOfKind('step', step, 'retryable')) return undefined
      if (issues.length > start || step === undefined || !ok) return undefined
      return isRecord(patch) ? { type, step, patch } : { type, step }
    }
    case 'send': {
      const event = str('event')
      const correlationId = str('correlationId')
      const eventId = str('eventId')
      const ok = json('payload')
      if (
        checkIds &&
        def !== undefined &&
        event !== undefined &&
        !Object.hasOwn(def.events, event)
      ) {
        issues.push({ message: `unknown event '${event}'`, path: [...path, 'event'] })
        return undefined
      }
      if (issues.length > start || event === undefined || !ok) return undefined
      return {
        type,
        event,
        payload: input.payload,
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(eventId === undefined ? {} : { eventId }),
      }
    }
    case 'cancel': {
      const reason = str('reason')
      if (issues.length > start) return undefined
      return reason === undefined ? { type } : { type, reason }
    }
    case 'compensate': {
      const from = str('from')
      const reason = str('reason')
      if (!stepOfKind('from', from, 'any')) return undefined
      if (issues.length > start) return undefined
      return {
        type,
        ...(from === undefined ? {} : { from }),
        ...(reason === undefined ? {} : { reason }),
      }
    }
    case 'skip': {
      // Any known step (the machine rejects completing or not-ready steps at dispatch time).
      const step = str('step')
      const reason = str('reason')
      if (!stepOfKind('step', step, 'any')) return undefined
      if (issues.length > start || step === undefined) return undefined
      return reason === undefined ? { type, step } : { type, step, reason }
    }
    case 'invalidate': {
      const step = str('step')
      const cascade = input.cascade
      if (cascade !== undefined && typeof cascade !== 'boolean') {
        issues.push({ message: "'cascade' must be a boolean", path: [...path, 'cascade'] })
      }
      if (!stepOfKind('step', step, 'any')) return undefined
      if (issues.length > start || step === undefined) return undefined
      return typeof cascade === 'boolean' ? { type, step, cascade } : { type, step }
    }
    case 'child': {
      const rawPath = input.path
      if (
        !Array.isArray(rawPath) ||
        rawPath.length === 0 ||
        rawPath.length > MAX_PATH_DEPTH * 2 ||
        !rawPath.every((s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_STRING)
      ) {
        issues.push({
          message: "'path' must be a non-empty array of step ids",
          path: [...path, 'path'],
        })
        return undefined
      }
      const segments: string[] = rawPath.map(String)
      const resolved = resolveCommandPath(def, segments, path, issues, checkIds)
      if (resolved === undefined) return undefined
      const total = depth + resolved.levels
      if (total > MAX_PATH_DEPTH) {
        issues.push({
          message: `child path nests deeper than ${MAX_PATH_DEPTH} (${total} levels)`,
          path: [...path, 'path'],
        })
        return undefined
      }
      const command = parse(
        input.command,
        [...path, 'command'],
        total,
        issues,
        resolved.def,
        checkIds,
      )
      if (command === undefined) return undefined
      return { type, path: segments, command }
    }
    default:
      return undefined
  }
}
