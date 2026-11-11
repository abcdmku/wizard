import type { ConsentInput, IntakeContext, PrefillResult, RiskInput } from '../../shared/index.js'

/** Host-owned I/O used by the durable intake procedure. */
export interface IntakeDeps {
  readonly prefill: (
    applicationId: IntakeContext['applicationId'],
    consent: ConsentInput,
    idempotencyKey: string,
  ) => Promise<PrefillResult>
  readonly enqueueRisk: (
    applicationId: IntakeContext['applicationId'],
    input: RiskInput,
    idempotencyKey: string,
  ) => Promise<string>
}
