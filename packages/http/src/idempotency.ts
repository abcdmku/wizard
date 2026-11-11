import { failure } from './http-response'
import type { Unrecorded } from './run-handle'
import { unrecordedResponse } from './run-responses'

/** A response stored under an idempotency key and replayed for repeats. @public */
export interface IdempotentResponse {
  readonly status: number
  readonly body: string
}

/** Result of claiming an idempotency key. @public */
export type IdempotencyClaim =
  | { readonly state: 'claimed'; readonly claimId: string }
  | { readonly state: 'pending'; readonly fingerprint: string }
  | {
      readonly state: 'completed'
      readonly fingerprint: string
      readonly response: IdempotentResponse
    }

/**
 * Atomic idempotency records shared by signed receivers (keyed by `webhook-id`) and API writes
 * (keyed by the `Idempotency-Key` header), scoped per API and tenant. `fingerprint` identifies
 * the request so a key reused for a different request is detected.
 * @public
 */
export interface IdempotencyStore {
  /** Claim `key` with a fresh identity, or report its existing pending or completed claim. */
  claim(key: string, fingerprint: string): IdempotencyClaim | PromiseLike<IdempotencyClaim>
  /**
   * Atomically store the response only if this live pending key still belongs to `claimId`.
   * Return false after expiration, eviction, completion, or replacement. Never alter a newer claim.
   */
  complete(
    key: string,
    claimId: string,
    response: IdempotentResponse,
  ): boolean | PromiseLike<boolean>
  /** Atomically drop only this live pending claim; return false if it no longer owns the key. */
  release(key: string, claimId: string): boolean | PromiseLike<boolean>
}

/** Options of `createMemoryIdempotencyStore`. @public */
export interface MemoryIdempotencyStoreOptions {
  /** How long a key is remembered. Defaults to 24 hours; keep it above the receiver replay window. */
  readonly ttlMs?: number
  /** Oldest keys are evicted beyond this count. Defaults to 10 000. */
  readonly maxEntries?: number
  readonly now?: () => number
}

interface MemoryRecord {
  readonly claimId: string
  readonly fingerprint: string
  readonly expiresAt: number
  readonly response?: IdempotentResponse
}

/**
 * In-process idempotency store. It only deduplicates within one process: share a database-backed
 * store (or a durable host) when several processes serve the same routes.
 * @public
 */
export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): IdempotencyStore {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
  const maxEntries = options.maxEntries ?? 10_000
  const now = options.now ?? Date.now
  const records = new Map<string, MemoryRecord>()
  const live = (key: string): MemoryRecord | undefined => {
    const record = records.get(key)
    if (record === undefined || record.expiresAt > now()) return record
    records.delete(key)
    return undefined
  }
  return {
    claim(key, fingerprint) {
      const record = live(key)
      if (record?.response !== undefined) {
        return { state: 'completed', fingerprint: record.fingerprint, response: record.response }
      }
      if (record !== undefined) return { state: 'pending', fingerprint: record.fingerprint }
      const claimId = crypto.randomUUID()
      records.set(key, { claimId, fingerprint, expiresAt: now() + ttlMs })
      while (records.size > maxEntries) {
        const oldest = records.keys().next().value
        if (oldest === undefined) break
        records.delete(oldest)
      }
      return { state: 'claimed', claimId }
    },
    complete(key, claimId, response) {
      const record = live(key)
      if (record?.claimId !== claimId || record.response !== undefined) return false
      records.set(key, { ...record, response: { ...response } })
      return true
    },
    release(key, claimId) {
      const record = live(key)
      if (record?.claimId !== claimId || record.response !== undefined) return false
      return records.delete(key)
    },
  }
}

/**
 * Run `produce` at most once per key: a repeat with the same fingerprint replays the stored
 * response, a repeat while the first is running is a 409, a key reused for another request is a
 * 422. The run's answer is stored whatever its status (a refused event may already be recorded
 * by the run); a throw or an `Unrecorded` refusal releases the key, so a retry reaches the run.
 */
export async function idempotent(
  store: IdempotencyStore,
  key: string | undefined,
  fingerprint: string,
  produce: () => Promise<Response | Unrecorded>,
): Promise<Response> {
  if (key === undefined) {
    const answer = await produce()
    return answer instanceof Response ? answer : unrecordedResponse(answer)
  }
  const claim = await store.claim(key, fingerprint)
  if (claim.state !== 'claimed' && claim.fingerprint !== fingerprint) {
    return failure(
      422,
      'IDEMPOTENCY_CONFLICT',
      'this idempotency key was already used for a different request',
    )
  }
  if (claim.state === 'pending') {
    return failure(
      409,
      'IDEMPOTENCY_PENDING',
      'a request with this idempotency key is still running; retry shortly',
      {},
      { 'retry-after': '1' },
    )
  }
  if (claim.state === 'completed') return replay(claim.response)
  let answer: Response | Unrecorded
  try {
    answer = await produce()
  } catch (error) {
    await store.release(key, claim.claimId)
    throw error
  }
  if (!(answer instanceof Response)) {
    await store.release(key, claim.claimId)
    return unrecordedResponse(answer)
  }
  await store.complete(key, claim.claimId, {
    status: answer.status,
    body: await answer.clone().text(),
  })
  return answer
}

function replay(response: IdempotentResponse): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'idempotent-replayed': 'true',
    },
  })
}
