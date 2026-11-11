/**
 * Terminal result waiters and subscriptions of one runtime. The result itself is derived from
 * the untyped machine state (`machine/run-result`); the typed `Run<F>` façade narrows the
 * same value to `RunResult<F>`.
 *
 * @internal
 */

import type { DomainEvent } from '../../machine/events'
import {
  type ChildResultOf,
  deriveRuntimeResult,
  type RuntimeResult,
} from '../../machine/run-result'
import type { WizardState } from '../../machine/state'
import { RunLifecycleError } from '../results'

export interface TerminalResultTracker {
  current(): RuntimeResult | undefined
  awaitResult(): Promise<RuntimeResult>
  subscribe(listener: (result: RuntimeResult) => void): () => void
  commit(state: WizardState, batch: readonly DomainEvent[]): void
  dispose(): void
}

export function createTerminalResultTracker(args: {
  readonly getState: () => WizardState
  readonly notify: <T>(listeners: Set<(value: T) => void>, value: T) => void
  readonly childResult?: ChildResultOf
}): TerminalResultTracker {
  const listeners = new Set<(result: RuntimeResult) => void>()
  const waiters = new Set<{
    readonly resolve: (result: RuntimeResult) => void
    readonly reject: (error: unknown) => void
  }>()
  let disposed = false
  /** Content of the last result listeners saw; only `reset` starts a new cycle. */
  let notifiedKey: string | undefined

  const derive = (state: WizardState): RuntimeResult | undefined =>
    deriveRuntimeResult(state, args.childResult)
  const rejectAll = (error: RunLifecycleError): void => {
    for (const waiter of Array.from(waiters)) waiter.reject(error)
    waiters.clear()
  }
  const observe = (result: RuntimeResult): void => {
    for (const waiter of Array.from(waiters)) waiter.resolve(result)
    waiters.clear()
    // A re-run compensation that ends exactly as before is not a new outcome for listeners.
    const key = resultKey(result)
    if (key === notifiedKey) return
    notifiedKey = key
    args.notify(listeners, result)
  }

  return {
    current() {
      return disposed ? undefined : derive(args.getState())
    },
    awaitResult() {
      if (disposed) return Promise.reject(new RunLifecycleError('RUN_DISPOSED'))
      const result = derive(args.getState())
      if (result !== undefined) return Promise.resolve(result)
      return new Promise<RuntimeResult>((resolve, reject) => {
        waiters.add({ resolve, reject })
      })
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      const result = derive(args.getState())
      if (result !== undefined) {
        notifiedKey = resultKey(result)
        args.notify(new Set([listener]), result)
      }
      return () => {
        listeners.delete(listener)
      }
    },
    commit(state, batch) {
      if (disposed) return
      if (batch.some((event) => event.type === 'run.reset')) {
        notifiedKey = undefined
        rejectAll(new RunLifecycleError('RUN_RESET'))
      }
      const result = derive(state)
      if (result !== undefined) observe(result)
    },
    dispose() {
      if (disposed) return
      disposed = true
      rejectAll(new RunLifecycleError('RUN_DISPOSED'))
      listeners.clear()
    },
  }
}

/** What a result says, without its position in the log (`seq` / `epoch`). */
function resultKey(result: RuntimeResult): string {
  if (result.status === 'done') return 'done'
  try {
    return `${result.status}:${JSON.stringify(result.failure, (key, value) =>
      key === 'seq' || key === 'epoch' ? undefined : value,
    )}`
  } catch {
    return `${result.status}:${result.seq}`
  }
}
