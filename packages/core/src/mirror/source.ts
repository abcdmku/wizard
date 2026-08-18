/**
 * `createMirrorSource(wizard, projection)` — the server half of the wire protocol (plan §8.9).
 *
 * Wraps a live `Wizard` and a deny-by-default `Projection` (of the SAME flow object —
 * `DEFINITION_INVALID` otherwise): `subscribe` pushes the current `Frame` immediately and then
 * one frame per committed batch; `dispatch` decodes a `WireCommand` with
 * `parseWireCommand(wizard.flow, …)` (shape + ids), checks the instance id and `expectedSeq`,
 * hands the typed command to `wizard.dispatch` and answers with a `WireAck`. A host wires
 * `subscribe` to its push channel (SSE / WS) and `dispatch` to its command endpoint, after its
 * own authorization.
 *
 * Ordering: dispatches are serialized through one gate, so the `expectedSeq` comparison and the
 * enqueue of the command are one atomic step — no two commands can pass against the same seq.
 * The gate is released as soon as the command is enqueued (synchronously for every command but
 * `send`, whose event boundary may be asynchronous), never held for the whole transaction, so a
 * slow hook in one client's transition does not block another client's `cancel`.
 *
 * @packageDocumentation
 */

import type { BoundaryResult } from '../authoring/compiled'
import type { AnyFlow } from '../authoring/types'
import { WizardError } from '../errors'
import type { Projection } from '../projection/define-projection'
import type { Snapshot, Wizard } from '../wizard/create-wizard'
import type { CommandResult } from '../wizard/results'
import { type Frame, parseWireCommand, type WireAck, type WireCommand } from './wire'

/**
 * Server half of a Mirror: frames out, wire commands in. `S` is the projected state type of
 * the projection it was created with (`ClientState<F, E>` for an `expose` projection, the
 * mapper's return type for a `select` one).
 * @public
 */
export interface MirrorSource<S> {
  /** Sends the current frame immediately, then one frame per committed batch. */
  subscribe(onFrame: (frame: Frame<S>) => void): () => void
  /**
   * Decode + gate a wire command and dispatch it. Never rejects for data problems: a bad
   * shape or an id unknown to the flow → `INVALID_COMMAND` (with issues), a foreign
   * `instanceId` → `INVALID_COMMAND`, an `expectedSeq` that is not the current seq → `STALE`,
   * a disposed wizard or source → `DISPOSED`; otherwise the wizard's own `CommandResult`. The
   * ack's `seq` is the instance seq after processing.
   */
  dispatch(command: WireCommand): Promise<WireAck>
  /** Stop pushing frames, drop every subscriber and answer `DISPOSED` to later commands. Does not dispose the wizard. */
  dispose(): void
}

/**
 * Create the server half of a Mirror for `wizard` seen through `projection` (which must be
 * defined for the wizard's flow OBJECT — `DEFINITION_INVALID` otherwise, same name or not).
 * Frames are built with `wizard.project(projection)` and cached per snapshot, so many
 * subscribers share one object.
 * @public
 */
export function createMirrorSource<F extends AnyFlow, S>(
  wizard: Wizard<F>,
  projection: Projection<F, S>,
): MirrorSource<S> {
  const listeners = new Set<(frame: Frame<S>) => void>()
  let cache: { readonly snapshot: Snapshot<F>; readonly frame: Frame<S> } | undefined
  let disposed = false
  /** Tail of the dispatch gate: resolves once the previous command has been enqueued. */
  let gate: Promise<void> = Promise.resolve()

  const currentFrame = (): Frame<S> => {
    const snapshot = wizard.getSnapshot()
    if (cache !== undefined && cache.snapshot === snapshot) return cache.frame
    const frame: Frame<S> = {
      kind: 'snapshot',
      instanceId: snapshot.instanceId,
      epoch: snapshot.epoch,
      seq: snapshot.seq,
      state: wizard.project(projection),
    }
    cache = { snapshot, frame }
    return frame
  }
  // Validates the projection against the flow eagerly (throws DEFINITION_INVALID).
  currentFrame()

  const unsubscribeWizard = wizard.subscribe(() => {
    if (listeners.size === 0) return
    const frame = currentFrame()
    for (const listener of Array.from(listeners)) listener(frame)
  })

  const ack = (commandId: string, result: CommandResult): WireAck => ({
    commandId,
    result,
    seq: wizard.getState().seq,
  })

  const disposedAck = (commandId: string): WireAck =>
    ack(commandId, { ok: false, code: 'DISPOSED', message: 'mirror source is disposed' })

  /** Decode outside the gate (pure), gate + enqueue inside it. */
  const process = (input: WireCommand, release: () => void): Promise<WireAck> => {
    if (disposed) {
      release()
      return Promise.resolve(disposedAck(commandIdOf(input)))
    }
    let parsed: BoundaryResult<WireCommand<F>>
    try {
      parsed = parseWireCommand(wizard.flow, input)
    } catch (error) {
      release()
      return Promise.resolve(
        ack(commandIdOf(input), {
          ok: false,
          code: 'INVALID_COMMAND',
          message: `invalid wire command: ${describe(error)}`,
        }),
      )
    }
    if (!parsed.ok) {
      release()
      return Promise.resolve(
        ack(commandIdOf(input), {
          ok: false,
          code: 'INVALID_COMMAND',
          message: 'invalid wire command',
          issues: parsed.issues,
        }),
      )
    }
    const wire = parsed.value
    if (wire.instanceId !== wizard.id) {
      release()
      return Promise.resolve(
        ack(wire.commandId, {
          ok: false,
          code: 'INVALID_COMMAND',
          message: `command addressed to instance '${wire.instanceId}', this source serves '${wizard.id}'`,
        }),
      )
    }
    const seq = wizard.getState().seq
    if (wire.expectedSeq !== undefined && wire.expectedSeq !== seq) {
      release()
      return Promise.resolve(
        ack(wire.commandId, {
          ok: false,
          code: 'STALE',
          message: `expected seq ${wire.expectedSeq}, instance is at ${seq}`,
        }),
      )
    }
    let pending: Promise<CommandResult>
    try {
      // `parseWireCommand(flow, …)` decoded `command` into a `Command<F>` — no cast needed.
      pending = wizard.dispatch(wire.command)
    } catch (error) {
      release()
      return Promise.reject(error)
    }
    // Every command but `send` is enqueued synchronously inside `dispatch()`; a `send` enqueues
    // once its event boundary settled, which is also when its promise settles.
    if (wire.command.type !== 'send') release()
    return pending.then(
      (result) => {
        release()
        return ack(wire.commandId, result)
      },
      (error: unknown) => {
        release()
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
      },
    )
  }

  return {
    subscribe(onFrame) {
      if (disposed) throw new WizardError('DISPOSED', 'mirror source is disposed')
      listeners.add(onFrame)
      onFrame(currentFrame())
      return () => {
        listeners.delete(onFrame)
      }
    },
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
      listeners.clear()
      cache = undefined
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
