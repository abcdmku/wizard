/** Abort work invalidated by committed lifecycle events before starting new effects. */
import type { DomainEvent } from '../machine/events'
import type { Executor } from './executor-types'
import type { TimerRegistry } from './timers'

interface CommittedEffectsOptions {
  readonly executor: Executor
  readonly timers: TimerRegistry
  readonly bridge: { disposeAll(): void } | undefined
  readonly cancelled: Map<string, { readonly seq: number; readonly reason: string | undefined }>
  readonly calls: { length: number }
  readonly yielded: { length: number }
}

export function abortCommittedWork(
  batch: readonly DomainEvent[],
  opts: CommittedEffectsOptions,
): void {
  for (const event of batch) {
    if (event.type === 'transition.failed' && event.error.code === 'CANCELLED') {
      opts.executor.abortTransaction(event.txId, event.error.message)
    } else if (
      event.type === 'step.cancelled' ||
      (event.type === 'step.skipped' && event.reason === 'fallback')
    ) {
      opts.executor.abort(event.step, event.reason)
      opts.cancelled.set(event.step, { seq: event.seq, reason: event.reason })
    } else if (event.type === 'flow.reset') {
      opts.executor.abortAll('flow reset')
      opts.calls.length = 0
      opts.yielded.length = 0
      opts.timers.clearAll()
      opts.bridge?.disposeAll()
    }
  }
}
