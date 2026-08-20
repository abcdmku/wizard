import { expectTypeOf } from 'vitest'
import {
  type AcquireLeaseResult,
  type CommitResult,
  createMemoryDurableStore,
  type DedupeClaimResult,
  type DurableStore,
  type Lease,
  type Version,
} from '../src'

declare const store: DurableStore
declare const lease: Lease

expectTypeOf(store).toMatchTypeOf<DurableStore>()
expectTypeOf(store.acquire('run', 'worker')).toEqualTypeOf<Promise<AcquireLeaseResult>>()
expectTypeOf(
  store.commit({
    lease,
    expected: null,
    next: { value: { status: 'idle' }, version: { epoch: 0, seq: 0 } },
  }),
).toEqualTypeOf<Promise<CommitResult>>()

const version: Version = { epoch: 2, seq: 4 }
expectTypeOf(version).toMatchTypeOf<Version>()

declare const result: DedupeClaimResult
if (result.ok && result.status === 'completed') {
  expectTypeOf(result.result).toEqualTypeOf<unknown>()
}

const memory = createMemoryDurableStore({
  retention: { completedDedupeMs: 1000, timerClaimMs: 1000 },
})
expectTypeOf(memory.keys()).toEqualTypeOf<readonly string[]>()

// @ts-expect-error the namespace is deliberately limited to command and event
store.claimDedupe({ lease, kind: 'task', id: 'id', digest: 'digest' })

// @ts-expect-error timer claims must carry the snapshot version they guard
store.claimTimer({ lease, timerId: 'timer', dueAt: 0 })
