import type { AnyWizard, CommandResult } from '@openwizard/core'
import type { ReleaseLeaseResult } from '@openwizard/durable/store'
import type { DurableCommandResult, DurableEventResult, DurableRunHost } from './durable-run'
import { claimForCommand, completeDedupe } from './durable-run-dedupe'
import type { HostState, PendingCommand } from './durable-run-state'
import { copyLease, copyVersion, digestOf, hostFailure } from './durable-run-values'

export function makeHost<F extends AnyWizard>(state: HostState<F>): DurableRunHost<F> {
  // Commands, events, and release run one at a time, so a release never cuts off a command that
  // already reached the run: its dedupe completion commits first.
  let operation = Promise.resolve()
  const serialize = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = operation.then(work, work)
    operation = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const release = (): Promise<ReleaseLeaseResult> =>
    serialize(async () => {
      const lost = state.isStopped()
      state.stop()
      // No store write of this host may land after release resolves.
      await state.awaitBarriers()
      return lost ? { ok: false, code: 'LEASE_LOST' } : state.store.release(state.getLease())
    })

  return {
    run: state.run,
    get lease() {
      return copyLease(state.getLease())
    },
    get version() {
      return copyVersion(state.getVersion())
    },
    renew: (options) => state.renewLease(options),
    dispatch(command, options) {
      // The caller may reuse its object for a separate local dispatch. Keep this invocation's
      // source identity private so only its own queue batch can complete the durable receipt.
      const invocation = { ...command }
      return serialize(async (): Promise<DurableCommandResult> => {
        if (state.isStopped()) return hostFailure('LEASE_LOST')
        const digest = options.digest ?? digestOf({ command: invocation })
        const claim = await state.store.claimDedupe({
          lease: state.getLease(),
          id: options.commandId,
          digest,
          ...(options.expectedVersion === undefined
            ? {}
            : { expectedVersion: options.expectedVersion }),
          request: invocation,
        })
        const claimed = claimForCommand(claim)
        if (claimed.kind === 'failure') return claimed.value
        if (claimed.kind === 'replayed') {
          return { ok: true, status: 'replayed', result: claimed.result, version: claimed.version }
        }
        const tracked: PendingCommand<F> = {
          id: options.commandId,
          claimId: claimed.claimId,
          digest,
          command: invocation,
        }
        state.trackCommand(tracked)
        let result: CommandResult
        try {
          result = await state.run.dispatch(
            invocation,
            options.expectedVersion === undefined
              ? undefined
              : { expectedVersion: options.expectedVersion },
          )
        } finally {
          state.trackCommand(undefined)
        }
        if (state.isStopped()) return tracked.failure ?? hostFailure('LEASE_LOST')
        if (tracked.completedVersion !== undefined) {
          return {
            ok: true,
            status: 'applied',
            result,
            version: copyVersion(tracked.completedVersion),
          }
        }
        const completed = await completeDedupe(state, {
          id: options.commandId,
          digest,
          claimId: claimed.claimId,
          result,
        })
        if (!completed.ok) return completed
        return { ok: true, status: 'applied', result, version: completed.version }
      })
    },
    send(event, payload, options) {
      return serialize(async (): Promise<DurableEventResult> => {
        if (state.isStopped()) return hostFailure('LEASE_LOST')
        // Core records `eventId` in the snapshot that the beforeEffects barrier commits, so the
        // id and the event's effects land in one fenced CAS write.
        const result = await state.run.send<typeof event, unknown>(event, payload, {
          eventId: options.eventId,
          ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
        })
        if (state.isStopped()) return hostFailure('LEASE_LOST')
        if (!result.ok) return result
        return { ...result, version: copyVersion(state.getVersion()) }
      })
    },
    release,
    async dispose() {
      await release()
    },
  }
}
