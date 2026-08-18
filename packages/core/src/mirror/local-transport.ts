/**
 * `createLocalTransport(source, options?)` — in-process loopback `Transport` over a
 * `MirrorSource`, for tests, examples and single-process apps. Optional deterministic latency
 * (`delayMs` + injectable `scheduler`) and JSON serialisation (`serialize: true`) so the loop
 * behaves like a real wire (frames and acks are decoupled from the wizard's objects).
 *
 * Exported from `@openwizard/core/testing` (a separate entry): its TYPES are imported from the
 * main entry by package name, so the testing declarations reference `@openwizard/core` instead
 * of duplicating the wire types.
 *
 * @packageDocumentation
 */

import type { MirrorSource, Scheduler, Transport, WireAck } from '@openwizard/core'
import { createRealScheduler } from '../interpreter/env'

/**
 * `createLocalTransport` options: `delayMs` delays every frame and every command/ack hop
 * (default 0 = synchronous frames, acks resolve on the wizard's own microtasks); `scheduler`
 * drives those delays (a test scheduler makes them deterministic); `serialize` JSON-round-trips
 * frames, commands and acks (default `false`).
 * @public
 */
export interface LocalTransportOptions {
  readonly delayMs?: number
  readonly scheduler?: Scheduler
  readonly serialize?: boolean
}

/**
 * Loopback transport over a `MirrorSource` (same process, no wire). With the defaults, frames
 * reach the Mirror synchronously on every commit and `send` resolves with the source's ack.
 * @public
 */
export function createLocalTransport<S>(
  source: MirrorSource<S>,
  options: LocalTransportOptions = {},
): Transport<S> {
  const delayMs = options.delayMs ?? 0
  const scheduler = options.scheduler ?? (delayMs > 0 ? createRealScheduler() : undefined)
  const clone = <T>(value: T): T =>
    options.serialize === true ? (JSON.parse(JSON.stringify(value)) as T) : value
  const later = (fn: () => void): void => {
    if (scheduler === undefined || delayMs <= 0) fn()
    else scheduler.setTimeout(fn, delayMs)
  }
  const hop = <T>(value: T): Promise<T> => new Promise((resolve) => later(() => resolve(value)))

  return {
    subscribe(onFrame) {
      let open = true
      const unsubscribe = source.subscribe((frame) => {
        const copy = clone(frame)
        later(() => {
          if (open) onFrame(copy)
        })
      })
      return () => {
        open = false
        unsubscribe()
      }
    },
    async send(command) {
      const wire = await hop(clone(command))
      const ack: WireAck = await source.dispatch(wire)
      return hop(clone(ack))
    },
  }
}
