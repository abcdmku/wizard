/**
 * `createMirrorSource(run, projection)` — the server half of the wire protocol (plan §8.9).
 *
 * Wraps a live `Run` and a `Projection` of the same authored wizard. `subscribe` pushes the
 * current `SnapshotFrame` immediately,
 * then one per committed batch, plus a `ProgressFrame` per hook `progress(value)` of a step the
 * projection explicitly allows; `dispatch` decodes
 * a `WireCommand` with
 * `parseWireCommand(run.flow, …)` (shape + ids), checks the instance id and `expectedSeq`,
 * optionally authorizes the decoded command against the current state and server-held scope,
 * then hands it to `run.dispatch` and answers with a `WireAck`. A host wires `subscribe` to its
 * push channel (SSE / WS) and `dispatch` to its command endpoint.
 *
 * Ordering: dispatches are serialized per source. `expectedSeq` also reaches the run's version
 * guard, checked when the command is processed after any asynchronous payload parsing. Work
 * from another source or a background hook can make that command stale. The source gate is
 * released as soon as the command is enqueued (synchronously for every command but
 * `send`, whose event boundary may be asynchronous), never held for the whole transaction, so a
 * slow hook in one client's transition does not block another client's `cancel`.
 *
 * @packageDocumentation
 */

import type {
  AnyFlow,
  Command,
  CommandResult,
  Projection,
  ProjectionDefinition,
  Run,
  Snapshot,
} from '@openwizard/core'
import { compile } from '../authoring/compile'
import type { BoundaryResult } from '../authoring/compiled'
import { describeError, WizardError } from '../errors'
import { bindParsedProjectionScope, parseProjectionScope } from '../projection/scope'
import { sameDefinition } from '../wizard/definition-identity'
import { notifyListeners, rethrowListenerError } from './listeners'
import { exposesProgress } from './progress'
import {
  type Frame,
  type ProgressFrame,
  parseWireCommand,
  type SnapshotFrame,
  type WireAck,
  type WireCommand,
} from './wire'

/**
 * Server half of a Mirror: frames out, wire commands in. `S` is the projected state type of
 * the projection it was created with (`ClientState<F, E>` for an `expose` projection, the
 * mapper's return type for a `select` one).
 * @public
 */
export interface MirrorSource<S> {
  /**
   * Sends the current snapshot frame immediately, then one per committed batch and a progress
   * frame per exposed `progress(value)`; `onClose` runs when the source is disposed (at once
   * when it already is — then nothing else happens).
   */
  subscribe(onFrame: (frame: Frame<S>) => void, onClose?: () => void): () => void
  /** The current snapshot frame (what a server renders with and hands to `createMirror({ initial })`). */
  getFrame(): SnapshotFrame<S>
  /**
   * Decode + gate a wire command and dispatch it. Never rejects for data problems: a bad
   * shape or an id unknown to the flow → `INVALID_COMMAND` (with issues), a foreign
   * `instanceId` → `INVALID_COMMAND`, an `expectedSeq` that is not the current seq → `STALE`,
   * a disposed run or source → `DISPOSED`; otherwise the run's own `CommandResult`. The
   * denied authorization returns `FORBIDDEN`. The ack's `seq` is the instance seq after
   * processing.
   */
  dispatch(command: WireCommand): Promise<WireAck>
  /** Stop pushing frames, drop every subscriber and answer `DISPOSED` to later commands. Does not dispose the run. */
  dispose(): void
}

/** Values passed to a Mirror source command authorization policy.
 * @public
 */
export interface MirrorAuthorizationInput<F extends AnyFlow, Scope> {
  readonly state: Snapshot<F>['state']
  readonly command: Command<F>
  readonly scope: [Scope] extends [never] ? undefined : Scope
}

/** Server-only principal and authorization policy for a Mirror source.
 * @public
 */
export type MirrorSourceOptions<F extends AnyFlow, Scope = never> = {
  readonly authorize?: (input: MirrorAuthorizationInput<F, Scope>) => boolean | PromiseLike<boolean>
  /** Reports subscriber failures without interrupting other subscribers. Default: rethrow asynchronously. */
  readonly onListenerError?: (error: unknown) => void
} & ([Scope] extends [never] ? { readonly scope?: never } : { readonly scope: Scope })

/**
 * Create the server half of a Mirror for `run` seen through `projection`, which must be
 * defined for the same authored wizard. Provided variants share identity; a separately authored
 * definition throws `DEFINITION_INVALID`, same name or not.
 * A scoped projection requires `{ scope }`; the source parses and captures it once. `authorize`
 * may allow a command from `{ state, command, scope }`. Frames are cached per snapshot, so many
 * subscribers share one object.
 * @public
 */
export function createMirrorSource<F extends AnyFlow, S, Scope = never>(
  run: Run<F>,
  projection:
    | Projection<NoInfer<F>, S, Scope>
    | Projection<ProjectionDefinition<NoInfer<F>>, S, Scope>,
  ...optionsArg: [Scope] extends [never]
    ? [options?: MirrorSourceOptions<F, Scope>]
    : [options: MirrorSourceOptions<F, Scope>]
): MirrorSource<S> {
  const options = optionsArg[0] as MirrorSourceOptions<F, Scope> | undefined
  if (!sameDefinition(run.flow, projection.flow)) {
    throw new WizardError(
      'DEFINITION_INVALID',
      `projection was defined for flow '${projection.flow.name}' (a different authored definition), not for this run's flow '${run.flow.name}'`,
    )
  }
  const scopeSupplied = options !== undefined && Object.hasOwn(options, 'scope')
  const parsedScope = parseProjectionScope(
    projection,
    scopeSupplied,
    options?.scope as Scope | undefined,
  )
  const projectionScope = (
    projection.scope === undefined
      ? []
      : [bindParsedProjectionScope(projection, parsedScope as Scope)]
  ) as [Scope] extends [never] ? [] : [scope: Scope]
  const authorize = options?.authorize
  const definition = compile(run.flow)
  const onListenerError = options?.onListenerError ?? rethrowListenerError
  const listeners = new Set<(frame: Frame<S>) => void>()
  const closers = new Map<(frame: Frame<S>) => void, () => void>()
  let cache: { readonly snapshot: Snapshot<F>; readonly frame: SnapshotFrame<S> } | undefined
  let disposed = false
  /** Tail of the dispatch gate: resolves once the previous command has been enqueued. */
  let gate: Promise<void> = Promise.resolve()

  const currentFrame = (): SnapshotFrame<S> => {
    const snapshot = run.getSnapshot()
    if (cache !== undefined && cache.snapshot === snapshot) return cache.frame
    const frame: SnapshotFrame<S> = {
      kind: 'snapshot',
      instanceId: snapshot.instanceId,
      epoch: snapshot.epoch,
      seq: snapshot.seq,
      state: run.project(projection, ...projectionScope),
    }
    cache = { snapshot, frame }
    return frame
  }
  // Validates the projection against the flow eagerly (throws DEFINITION_INVALID).
  currentFrame()

  const push = (frame: Frame<S>): void => {
    notifyListeners(listeners, frame, onListenerError)
  }
  const unsubscribeWizard = run.subscribe(() => {
    if (listeners.size > 0) push(currentFrame())
  })
  // Transient progress crosses only for steps the projection exposes it for (deny-by-default).
  const unobserveWizard = run.observe((event) => {
    if (event.type !== 'step.progress' || listeners.size === 0) return
    if (!exposesProgress(projection, definition, event.path, event.step)) return
    const { instanceId, epoch, seq } = run.getState()
    const { step, value, at, path } = event
    const progress: ProgressFrame = {
      kind: 'progress',
      instanceId,
      epoch,
      seq,
      event: { type: 'step.progress', step, value, seq: event.seq, at, path },
    }
    push(progress)
  })

  const ack = (commandId: string, result: CommandResult): WireAck => ({
    commandId,
    result,
    seq: run.getState().seq,
  })

  const disposedAck = (commandId: string): WireAck =>
    ack(commandId, { ok: false, code: 'DISPOSED', message: 'mirror source is disposed' })

  const forbiddenAck = (commandId: string): WireAck =>
    ack(commandId, {
      ok: false,
      code: 'FORBIDDEN',
      message: 'command is not authorized',
    })

  /** Decode outside the gate (pure), gate + enqueue inside it. */
  const process = async (input: WireCommand, release: () => void): Promise<WireAck> => {
    if (disposed) {
      release()
      return disposedAck(commandIdOf(input))
    }
    let parsed: BoundaryResult<WireCommand<F>>
    try {
      parsed = parseWireCommand(run.flow, input)
    } catch (error) {
      release()
      return ack(commandIdOf(input), {
        ok: false,
        code: 'INVALID_COMMAND',
        message: `invalid wire command: ${describeError(error)}`,
      })
    }
    if (!parsed.ok) {
      release()
      return ack(commandIdOf(input), {
        ok: false,
        code: 'INVALID_COMMAND',
        message: 'invalid wire command',
        issues: parsed.issues,
      })
    }
    const wire = parsed.value
    if (wire.instanceId !== run.id) {
      release()
      return ack(wire.commandId, {
        ok: false,
        code: 'INVALID_COMMAND',
        message: `command addressed to instance '${wire.instanceId}', this source serves '${run.id}'`,
      })
    }
    if (authorize !== undefined) {
      let allowed = false
      try {
        allowed =
          (await authorize({
            state: run.getState(),
            command: wire.command,
            scope: parsedScope as MirrorAuthorizationInput<F, Scope>['scope'],
          })) === true
      } catch {
        allowed = false
      }
      if (!allowed) {
        release()
        return forbiddenAck(wire.commandId)
      }
    }
    if (disposed) {
      release()
      return disposedAck(wire.commandId)
    }
    const { epoch, seq } = run.getState()
    if (wire.expectedSeq !== undefined && wire.expectedSeq !== seq) {
      release()
      return ack(wire.commandId, {
        ok: false,
        code: 'STALE',
        message: `expected seq ${wire.expectedSeq}, instance is at ${seq}`,
      })
    }
    let pending: Promise<CommandResult>
    try {
      // `parseWireCommand(flow, …)` decoded `command` into a `Command<F>` — no cast needed.
      pending = run.dispatch(
        wire.command,
        wire.expectedSeq === undefined
          ? undefined
          : { expectedVersion: { epoch, seq: wire.expectedSeq } },
      )
    } catch (error) {
      release()
      throw error
    }
    // Every command but `send` is enqueued synchronously inside `dispatch()`; a `send` enqueues
    // once its event boundary settled, which is also when its promise settles.
    if (wire.command.type !== 'send') release()
    try {
      return ack(wire.commandId, await pending)
    } catch (error) {
      if (error instanceof WizardError) {
        return ack(wire.commandId, {
          ok: false,
          code: error.code,
          message: error.message,
          ...(error.step === undefined ? {} : { step: error.step }),
          ...(error.issues === undefined ? {} : { issues: error.issues }),
        })
      }
      throw error
    } finally {
      release()
    }
  }

  return {
    subscribe(onFrame, onClose) {
      if (disposed) {
        if (onClose !== undefined) notifyListeners([onClose], undefined, onListenerError)
        return () => {}
      }
      // A wrapper per subscription, so the same callback can subscribe twice independently.
      const listener = (frame: Frame<S>): void => onFrame(frame)
      listeners.add(listener)
      if (onClose !== undefined) closers.set(listener, onClose)
      notifyListeners([listener], currentFrame(), onListenerError)
      return () => {
        listeners.delete(listener)
        closers.delete(listener)
      }
    },
    getFrame: currentFrame,
    dispatch(input) {
      if (disposed) return Promise.resolve(disposedAck(commandIdOf(input)))
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const previous = gate
      gate = held
      return previous.then(() => process(input, release))
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeWizard()
      unobserveWizard()
      const closing = Array.from(closers.values())
      listeners.clear()
      closers.clear()
      cache = undefined
      notifyListeners(closing, undefined, onListenerError)
    },
  }
}

/** Best-effort `commandId` echo for acks of commands that failed to decode. */
function commandIdOf(input: unknown): string {
  if (typeof input === 'object' && input !== null && Object.hasOwn(input, 'commandId')) {
    const id = (input as { readonly commandId?: unknown }).commandId
    if (typeof id === 'string') return id
  }
  return ''
}
