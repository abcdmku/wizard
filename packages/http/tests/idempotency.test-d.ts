import { expectTypeOf } from 'vitest'
import type { IdempotencyStore } from '../src'

declare const store: IdempotencyStore
const claim = await store.claim('key', 'fingerprint')
if (claim.state === 'claimed') {
  expectTypeOf(claim.claimId).toEqualTypeOf<string>()
  expectTypeOf(store.complete('key', claim.claimId, { status: 200, body: '{}' })).toEqualTypeOf<
    boolean | PromiseLike<boolean>
  >()
  expectTypeOf(store.release('key', claim.claimId)).toEqualTypeOf<boolean | PromiseLike<boolean>>()
}
// @ts-expect-error completing requires the captured claim identity
store.complete('key', { status: 200, body: '{}' })
// @ts-expect-error releasing requires the captured claim identity
store.release('key')
