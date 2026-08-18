/**
 * `createMirror({ transport })` — the client-side, read-only replica of a wizard seen through a
 * projection (plan §1.7 / §8.9). Typed by the projection (`createMirror<typeof projection>`, a
 * type-only import on the client), it applies frames from the transport, exposes the latest
 * projected state with `getSnapshot`/`subscribe` (stable identity per applied frame, structural
 * sharing of unchanged slices), and offers the same typed command sugar as `Wizard`, each call
 * travelling as a `WireCommand` and resolving with the ack's `CommandResult`.
 *
 * Frame rules: every frame goes through `parseFrame` (malformed frames are ignored); a frame is
 * applied only when its `(epoch, seq)` is newer than the last applied frame of the same
 * instance; an `epoch` change resets local state; a frame from a NEW instance id switches the
 * mirror to that instance and retires the previous id for good (a delayed frame of a retired
 * instance is ignored, so `A → B → late A` cannot flip the mirror back). State only ever
 * arrives through frames — never through acks (no optimistic UI in v0.1); an ack whose
 * `commandId` is not the one sent rejects the call (`WizardError('INVALID_COMMAND')`).
 *
 * @packageDocumentation
 */

import type { DraftOf, EventType, StepId, TaskId, ViewId } from '../authoring/types'
import { WizardError } from '../errors'
import { createIdGenerator, type IdGenerator } from '../interpreter/env'
import type {
  AnyProjection,
  ProjectionFlow,
  ProjectionOutput,
} from '../projection/define-projection'
import type { Command } from '../wizard/create-wizard'
import type { CommandResult } from '../wizard/results'
import type { Transport } from './transport'
import { type Frame, parseFrame, type WireAck, type WireCommand } from './wire'

/**
 * `createMirror` options: the `transport` (typed by the projected state), an optional id
 * generator for `commandId`s, and `optimisticConcurrency` (send `expectedSeq` = the last
 * applied seq with every command, so a concurrent change answers `STALE`; default `false`).
 * @public
 */
export interface MirrorOptions<P extends AnyProjection> {
  readonly transport: Transport<ProjectionOutput<P>>
  readonly ids?: IdGenerator
  readonly optimisticConcurrency?: boolean
}

/**
 * Client-side replica of a wizard through projection `P`: read the projected state
 * (`getSnapshot`/`subscribe`), and send typed commands — the same sugar as `Wizard`, each
 * resolving with the ack's `CommandResult`; transport failures and misrouted acks reject.
 * `instanceId/epoch/seq` mirror the last applied frame (`null` before the first one);
 * `connected` is true from the first frame until `dispose`.
 * @public
 */
export interface Mirror<P extends AnyProjection> {
  /** Latest projected state (stable identity per applied frame), `null` before the first frame. */
  getSnapshot(): ProjectionOutput<P> | null
  /** Notified after every applied frame and on `dispose`; a no-op after `dispose`. */
  subscribe(listener: () => void): () => void
  readonly instanceId: string | null
  readonly epoch: number | null
  readonly seq: number | null
  readonly connected: boolean
  start(): Promise<CommandResult>
  next(): Promise<CommandResult>
  back(): Promise<CommandResult>
  go(step: ViewId<ProjectionFlow<P>>): Promise<CommandResult>
  setInput<K extends ViewId<ProjectionFlow<P>>>(
    step: K,
    patch: DraftOf<ProjectionFlow<P>, K>,
  ): Promise<CommandResult>
  resetInput(step: ViewId<ProjectionFlow<P>>): Promise<CommandResult>
  send<E extends EventType<ProjectionFlow<P>>>(
    event: E,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<CommandResult>
  run(step: TaskId<ProjectionFlow<P>>): Promise<CommandResult>
  retry(step: TaskId<ProjectionFlow<P>>): Promise<CommandResult>
  cancel(reason?: string): Promise<CommandResult>
  runReady(): Promise<CommandResult>
  compensate(options?: {
    readonly from?: StepId<ProjectionFlow<P>>
    readonly reason?: string
  }): Promise<CommandResult>
  reset(): Promise<CommandResult>
  /** The wire door: any `Command` of the projection's flow, sent as-is (the server re-decodes it with `parseCommand`). */
  dispatch(command: Command<ProjectionFlow<P>>): Promise<CommandResult>
  /** Unsubscribe from the transport; later commands resolve `{ ok: false, code: 'DISPOSED' }`. */
  dispose(): void
}

/**
 * Create a Mirror over `transport`. Subscribes immediately; the server sends the current frame
 * on subscribe, so `getSnapshot()` is non-null as soon as the transport delivers it.
 * @public
 */
export function createMirror<P extends AnyProjection>(options: MirrorOptions<P>): Mirror<P> {
  type S = ProjectionOutput<P>
  const ids = options.ids ?? createIdGenerator()
  const listeners = new Set<() => void>()
  /** Instance ids the mirror moved away from: their late frames are ignored for good. */
  const retired = new Set<string>()
  let last: Frame<S> | null = null
  let disposed = false

  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener()
  }

  const apply = (input: Frame<S>): void => {
    if (disposed) return
    const parsed = parseFrame(input)
    if (!parsed.ok) return
    const frame = parsed.value as Frame<S>
    if (retired.has(frame.instanceId)) return
    if (last !== null && frame.instanceId === last.instanceId && !isNewer(frame, last)) return
    const reset =
      last === null || frame.instanceId !== last.instanceId || frame.epoch !== last.epoch
    if (last !== null && frame.instanceId !== last.instanceId) retired.add(last.instanceId)
    // Structural sharing keeps unchanged slices identical across frames (cheap selectors);
    // an epoch/instance change starts from scratch.
    const state = reset ? frame.state : (share(last?.state, frame.state) as S)
    last = { ...frame, state }
    notify()
  }

  const unsubscribe = options.transport.subscribe(apply)

  // Sugar builds untyped (string-id) commands; the public `dispatch` narrows to the projection flow.
  const dispatch = async (command: Command): Promise<CommandResult> => {
    if (disposed) return { ok: false, code: 'DISPOSED', message: 'mirror is disposed' }
    if (last === null) {
      return {
        ok: false,
        code: 'INVALID_COMMAND',
        message: 'mirror has not received a frame yet (no instance to address)',
      }
    }
    const wire: WireCommand = {
      commandId: ids.id('cmd'),
      instanceId: last.instanceId,
      ...(options.optimisticConcurrency === true ? { expectedSeq: last.seq } : {}),
      command,
    }
    const ack = await options.transport.send(wire)
    if (!isAckFor(ack, wire.commandId)) {
      throw new WizardError(
        'INVALID_COMMAND',
        `transport answered command '${wire.commandId}' with ${describeAck(ack)}`,
      )
    }
    return ack.result
  }

  return {
    getSnapshot: () => (last === null ? null : last.state),
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get instanceId() {
      return last === null ? null : last.instanceId
    },
    get epoch() {
      return last === null ? null : last.epoch
    },
    get seq() {
      return last === null ? null : last.seq
    },
    get connected() {
      return !disposed && last !== null
    },
    start: () => dispatch({ type: 'start' }),
    next: () => dispatch({ type: 'next' }),
    back: () => dispatch({ type: 'back' }),
    go: (step) => dispatch({ type: 'go', step }),
    setInput: (step, patch) => dispatch({ type: 'setInput', step, patch }),
    resetInput: (step) => dispatch({ type: 'resetInput', step }),
    send: (event, payload, options) =>
      dispatch(
        options?.correlationId === undefined
          ? { type: 'send', event, payload }
          : { type: 'send', event, payload, correlationId: options.correlationId },
      ),
    run: (step) => dispatch({ type: 'run', step }),
    retry: (step) => dispatch({ type: 'retry', step }),
    cancel: (reason) =>
      dispatch(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
    runReady: () => dispatch({ type: 'runReady' }),
    compensate: (options) =>
      dispatch({
        type: 'compensate',
        ...(options?.from === undefined ? {} : { from: options.from }),
        ...(options?.reason === undefined ? {} : { reason: options.reason }),
      }),
    reset: () => dispatch({ type: 'reset' }),
    dispatch,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      notify()
      listeners.clear()
    },
  }
}

function isNewer(frame: Frame<unknown>, last: Frame<unknown>): boolean {
  return frame.epoch > last.epoch || (frame.epoch === last.epoch && frame.seq > last.seq)
}

/** An ack is accepted only when it is a `{ commandId, result: { ok }, seq }` for the command sent. */
function isAckFor(ack: unknown, commandId: string): ack is WireAck {
  if (!isPlainObject(ack) || ack.commandId !== commandId) return false
  const result = ack.result
  return (
    isPlainObject(result) &&
    typeof result.ok === 'boolean' &&
    typeof ack.seq === 'number' &&
    Number.isInteger(ack.seq) &&
    ack.seq >= 0
  )
}

function describeAck(ack: unknown): string {
  if (isPlainObject(ack) && typeof ack.commandId === 'string') {
    return `an ack for command '${ack.commandId}'`
  }
  return 'a malformed ack'
}

/**
 * Return `next` with every sub-tree that deep-equals the corresponding sub-tree of `prev`
 * replaced by the `prev` reference (plain objects and arrays only). `prev` itself is returned
 * when the two are deep-equal. Keys are always written as own properties, so a step id like
 * `__proto__` survives (a plain assignment would set the prototype instead).
 */
function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length
    const out = next.map((item, i) => {
      const shared = share(prev[i], item)
      if (shared !== prev[i]) same = false
      return shared
    })
    return same ? prev : out
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(prev).length
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const shared = share(Object.hasOwn(prev, key) ? prev[key] : undefined, next[key])
      if (!Object.hasOwn(prev, key) || shared !== prev[key]) same = false
      setOwn(out, key, shared)
    }
    return same ? prev : out
  }
  return next
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Own-property write even for `__proto__` (a plain assignment would change the prototype). */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  } else {
    target[key] = value
  }
}
