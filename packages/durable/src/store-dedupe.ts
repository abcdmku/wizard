import type { FenceToken, Lease, Version } from './store'

/**
 * A request to claim a command id. `digest` must identify the full logical
 * request, not only its caller-generated id.
 *
 * `expectedVersion` gates only a new claim or a takeover. An existing replay,
 * digest conflict, same-fence pending claim, or applied claim wins before that
 * version check. `request` is stored with a new claim and echoed back while it
 * is open.
 *
 * Event ids are not claimed here: core records them in the run snapshot, which
 * the host commits with the same fenced CAS as every other state change.
 *
 * @public
 */
export interface DedupeClaimInput {
  readonly lease: Lease
  readonly id: string
  readonly digest: string
  readonly expectedVersion?: Version
  readonly request?: unknown
}

/**
 * The result of a command claim: a fresh `claimed` id, a claim still owned by
 * this fence (`pending`), a claim an older fence `applied` to a committed
 * snapshot but never completed, or the `completed` result to replay.
 *
 * @public
 */
export type DedupeClaimResult =
  | {
      readonly ok: true
      readonly status: 'claimed'
      readonly claimId: string
      readonly request?: unknown
    }
  | {
      readonly ok: true
      readonly status: 'pending'
      readonly claimId: string
      readonly ownerFence: FenceToken
      readonly claimedAt: number
      readonly request?: unknown
    }
  | { readonly ok: true; readonly status: 'applied' }
  | {
      readonly ok: true
      readonly status: 'completed'
      readonly digest: string
      readonly result: unknown
    }
  | { readonly ok: false; readonly code: 'LEASE_LOST' }
  | {
      readonly ok: false
      readonly code: 'CAS_CONFLICT'
      readonly actual: Version | null
    }
  | {
      readonly ok: false
      readonly code: 'DEDUPLICATE_CONFLICT'
      readonly existingDigest: string
    }

/**
 * Marks a pending claim of the committing fence `applied`, atomically with `CommitInput.next`. A
 * newer fence never takes an applied claim over, so its command never runs twice. @public
 */
export interface DedupeApplication {
  readonly id: string
  readonly claimId: string
}

/**
 * Completes a pending or applied claim of the committing fence, atomically with the rest of the
 * commit. @public
 */
export interface DedupeCompletion {
  readonly id: string
  readonly digest: string
  readonly claimId: string
  readonly result: unknown
}
