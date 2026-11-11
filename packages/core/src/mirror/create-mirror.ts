/**
 * `createMirror({ transport })` — the client-side, read-only replica of a run seen through a
 * projection. Typed by the projection (`createMirror<typeof projection>`, a
 * type-only import on the client), it applies frames from the transport, exposes the latest
 * projected state with `getSnapshot`/`subscribe` (stable identity per change, structural
 * sharing of unchanged slices), and offers the same typed command sugar as `Run`, each call
 * travelling as a `WireCommand` and resolving with a `MirrorResult` (never rejecting).
 *
 * Frame rules: every frame goes through `parseFrame` (malformed frames are ignored); a frame is
 * applied only when its `(epoch, seq)` is newer than the last applied frame of the same
 * instance; an `epoch` change resets local state; a frame from a NEW instance id switches the
 * mirror to that instance and retires the previous id for good (a delayed frame of a retired
 * instance is ignored, so `A → B → late A` cannot flip the mirror back).
 *
 * Progress: `observe(listener)` receives the transient `step.progress` events the server forwards
 * (progress frames of the current instance and epoch, not older than the applied state) — the
 * same events `run.observe()` delivers locally; they never touch the state. As on a run, a
 * throwing `subscribe`/`observe` listener never stops the others: its error goes to
 * `onListenerError` (default: rethrown asynchronously).
 *
 * Optimistic drafts: `setInput` is merged into the visible state at once and reconciled once a
 * frame at or past the seq of its ack arrives (dropped on a failed command) — see `./drafts`.
 * Everything else only changes through frames.
 *
 * Connection: `connected` is true from the first frame of the current subscription until the
 * transport reports `onClose`, `connect()` re-subscribes, or `dispose()`. `connect(transport?)`
 * re-subscribes on the same Mirror object (reconnect, or attach a transport later), so a React
 * tree bound to it never remounts. `initial` seeds the state (a frame rendered on the server).
 *
 * Child flows: `mirror.child(step)` returns a `MirrorChild` — the same command sugar typed by
 * the child flow, every call wrapped as `{ type: 'child', path, command }`.
 *
 * @packageDocumentation
 */

import type { AnyProjection, Command, ProjectionFlow, ProjectionOutput } from '@openwizard/core'
import { describeError } from '../errors'
import { createIdGenerator, type IdGenerator } from '../interpreter/env'
import { isPlainObject } from '../machine/util'
import { commandSugar, type MirrorCommands, type MirrorResult } from './commands'
import { draftOf, overlayDrafts, type PendingDraft, share } from './drafts'
import { notifyListeners, rethrowListenerError } from './listeners'
import type { Transport } from './transport'
import {
  type Frame,
  type ProgressFrame,
  parseFrame,
  type SnapshotFrame,
  type StepProgressEvent,
  type WireAck,
  type WireCommand,
} from './wire'

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
export interface MirrorOptions<P extends AnyProjection> {
  readonly transport?: Transport<ProjectionOutput<P>>
  readonly initial?: SnapshotFrame<ProjectionOutput<P>>
  readonly ids?: IdGenerator
  readonly optimisticConcurrency?: boolean
  readonly onListenerError?: (error: unknown) => void
}

/**
 * Client-side replica of a run through projection `P`: read the projected state
 * (`getSnapshot`/`subscribe`), and send typed commands — the same sugar as `Run`
 * (`MirrorCommands`), each resolving with a `MirrorResult`. `instanceId/epoch/seq` mirror the
 * last applied frame (`null` before the first one).
 * @public
 */
export interface Mirror<P extends AnyProjection> extends MirrorCommands<ProjectionFlow<P>> {
  /** Latest projected state with pending drafts merged in (stable identity per change), `null` before the first frame. */
  getSnapshot(): ProjectionOutput<P> | null
  /** Notified after every applied frame, draft change, connection change and on `dispose`; a no-op after `dispose`. */
  subscribe(listener: () => void): () => void
  /**
   * Transient events from the server, like `run.observe()`: the hook `progress(value)` of each
   * step a projection explicitly allows through its progress spec,
   * never part of the state. A no-op after `dispose`.
   */
  observe(listener: (event: StepProgressEvent<ProjectionFlow<P>>) => void): () => void
  readonly instanceId: string | null
  readonly epoch: number | null
  readonly seq: number | null
  /** True from the first frame of the current subscription until the transport closes, `connect()` or `dispose()`. */
  readonly connected: boolean
  /** (Re)subscribe to `transport` (default: the current one) — reconnect without a new Mirror. State and drafts are kept. */
  connect(transport?: Transport<ProjectionOutput<P>>): void
  /** Unsubscribe from the transport; later commands resolve `{ ok: false, code: 'DISPOSED' }`. */
  dispose(): void
}

/**
 * Create a Mirror over `transport`. Subscribes immediately; the server sends the current frame
 * on subscribe, so `getSnapshot()` is non-null as soon as the transport delivers it (at once
 * with `initial`).
 * @public
 */
export function createMirror<P extends AnyProjection>(options: MirrorOptions<P>): Mirror<P> {
  type S = ProjectionOutput<P>
  const ids = options.ids ?? createIdGenerator()
  const listeners = new Set<() => void>()
  const observers = new Set<(event: StepProgressEvent<ProjectionFlow<P>>) => void>()
  /** Instance ids the mirror moved away from: their late frames are ignored for good. */
  const retired = new Set<string>()
  /** Pending `setInput` patches by `commandId`, in send order. */
  const drafts = new Map<string, PendingDraft>()
  let transport = options.transport
  let last: SnapshotFrame<S> | null = null
  let view: S | null = null
  let connected = false
  let disposed = false
  let generation = 0
  let unsubscribe = (): void => {}
  const onListenerError = options.onListenerError ?? rethrowListenerError

  /** Call every listener with `value`; one that throws is reported and never stops the rest. */
  const each = <T>(targets: ReadonlySet<(value: T) => void>, value: T): void => {
    notifyListeners(targets, value, onListenerError)
  }
  const notify = (): void => each(listeners, undefined)

  /** Recompute the visible state from the last frame + drafts (sharing unchanged slices). */
  const refresh = (reset: boolean): void => {
    if (last === null) return
    const next = drafts.size === 0 ? last.state : (overlayDrafts(last.state, drafts.values()) as S)
    view = reset ? next : (share(view, next) as S)
  }

  /** Drop drafts the server state already contains (ack seq reached). */
  const settleDrafts = (seq: number): void => {
    for (const [id, draft] of drafts) {
      if (draft.ackSeq !== undefined && draft.ackSeq <= seq) drafts.delete(id)
    }
  }

  /** Hand a progress event to the observers when it belongs to the applied instance and epoch. */
  const progress = (frame: ProgressFrame): void => {
    if (last === null || frame.instanceId !== last.instanceId) return
    if (frame.epoch !== last.epoch || frame.seq < last.seq) return
    // Typed by the projection's flow on trust, like the frame's projected `state`.
    each(observers, frame.event as StepProgressEvent<ProjectionFlow<P>>)
  }

  const receive = (input: Frame<S>): void => {
    if (disposed) return
    const parsed = parseFrame(input)
    if (!parsed.ok) return
    if (parsed.value.kind === 'progress') {
      progress(parsed.value)
      return
    }
    const frame = parsed.value as SnapshotFrame<S>
    if (retired.has(frame.instanceId)) return
    const opened = !connected
    connected = true
    if (last !== null && frame.instanceId === last.instanceId && !isNewer(frame, last)) {
      if (opened) notify()
      return
    }
    const reset =
      last === null || frame.instanceId !== last.instanceId || frame.epoch !== last.epoch
    if (last !== null && frame.instanceId !== last.instanceId) retired.add(last.instanceId)
    if (reset) drafts.clear()
    else settleDrafts(frame.seq)
    last = frame
    refresh(reset)
    notify()
  }

  const connect = (next?: Transport<S>): void => {
    if (disposed) return
    if (next !== undefined) transport = next
    unsubscribe()
    unsubscribe = () => {}
    const wasConnected = connected
    connected = false
    const current = transport
    const token = ++generation
    if (current !== undefined) {
      unsubscribe = current.subscribe(
        (frame) => {
          if (token === generation) receive(frame)
        },
        () => {
          if (token !== generation || !connected) return
          connected = false
          notify()
        },
      )
    }
    if (wasConnected && !connected) notify()
  }

  const dropDraft = (commandId: string): void => {
    if (!drafts.delete(commandId)) return
    refresh(false)
    notify()
  }

  // Sugar builds untyped (string-id) commands; the public `dispatch` narrows to the projection flow.
  const dispatch = async (command: Command): Promise<MirrorResult> => {
    if (disposed) return { ok: false, code: 'DISPOSED', message: 'mirror is disposed' }
    if (transport === undefined) {
      return {
        ok: false,
        code: 'TRANSPORT_FAILED',
        message: 'mirror has no transport (pass one to createMirror or mirror.connect)',
      }
    }
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
    const draft = draftOf(command)
    if (draft !== undefined) {
      drafts.set(wire.commandId, draft)
      refresh(false)
      notify()
    }
    let ack: unknown
    try {
      ack = await transport.send(wire)
    } catch (error) {
      dropDraft(wire.commandId)
      return {
        ok: false,
        code: 'TRANSPORT_FAILED',
        message: `transport failed: ${describeError(error)}`,
      }
    }
    if (!isAckFor(ack, wire.commandId)) {
      dropDraft(wire.commandId)
      return {
        ok: false,
        code: 'TRANSPORT_FAILED',
        message: `transport answered command '${wire.commandId}' with ${describeAck(ack)}`,
      }
    }
    if (draft !== undefined) {
      if (!ack.result.ok || (last !== null && last.seq >= ack.seq)) dropDraft(wire.commandId)
      else draft.ackSeq = ack.seq
    }
    return ack.result
  }

  if (options.initial !== undefined) receive(options.initial)
  connected = false // the initial frame is state, not a connection
  connect()

  return {
    getSnapshot: () => view,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    observe(listener) {
      if (disposed) return () => {}
      observers.add(listener)
      return () => {
        observers.delete(listener)
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
      return connected
    },
    connect,
    ...commandSugar<ProjectionFlow<P>>(dispatch, []),
    dispose() {
      if (disposed) return
      disposed = true
      connected = false
      unsubscribe()
      drafts.clear()
      notify()
      listeners.clear()
      observers.clear()
    },
  }
}

function isNewer(frame: SnapshotFrame<unknown>, last: SnapshotFrame<unknown>): boolean {
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
