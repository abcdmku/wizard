/** Cooperative abort shared by step cancellation and navigation transactions. @internal */
import { codedError } from './errors'
import type { InFlight } from './executor-types'

export function abortCalls(
  calls: Iterable<InFlight>,
  reason: string | undefined,
  armGrace: (call: InFlight, reason: string | undefined) => void,
): void {
  for (const inf of Array.from(calls)) {
    if (inf.settled) continue
    inf.aborted = true
    inf.controller.abort(
      codedError('AbortError', 'ABORTED', reason ?? `step '${inf.effect.step}' cancelled`),
    )
    armGrace(inf, reason)
  }
}
