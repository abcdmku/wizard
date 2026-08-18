/*
 * Injectable runtime environment: clock, scheduler and id generator.
 *
 * The interpreter never touches `Date.now()` or `setTimeout` directly, so a
 * test can drive time deterministically with `createTestScheduler()`
 * (`./test-scheduler`, exported from `@openwizard/core/testing`: `advance(ms)` /
 * `flush()`), and every id in an event trace is reproducible with
 * `createSequentialIds()`. `Clock` and `Scheduler` are public
 * (`createWizard({ clock, scheduler })`); the id generator and the real
 * implementations are internal.
 */

/**
 * Wall clock the runtime reads for timestamps and timer deadlines (`createWizard({ clock })`).
 * @public
 */
export interface Clock {
  /** Monotonic-enough wall clock in ms. */
  now(): number
}

/**
 * Timer scheduler the runtime arms retries, wait timeouts and inbox TTLs with
 * (`createWizard({ scheduler })`). Handles are opaque: the runtime only ever passes them back
 * to `clearTimeout` of the same scheduler.
 * @public
 */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface IdGenerator {
  /** Unique id with a readable prefix (`tx`, `fx`, `evt`, `wiz`, ...). */
  id(prefix: string): string
}

export interface RuntimeEnv {
  readonly clock: Clock
  readonly scheduler: Scheduler
  readonly ids: IdGenerator
}

// ---------------------------------------------------------------------------
// Real implementations
// ---------------------------------------------------------------------------

export function createRealClock(): Clock {
  return { now: () => Date.now() }
}

/** Largest delay `setTimeout` accepts (2^31 - 1 ms); longer waits are chained. */
const MAX_TIMEOUT_MS = 2_147_483_647

interface ChainedHandle {
  inner: ReturnType<typeof setTimeout> | undefined
  cancelled: boolean
}

export function createRealScheduler(): Scheduler {
  return {
    setTimeout(fn, ms) {
      const handle: ChainedHandle = { inner: undefined, cancelled: false }
      const arm = (remaining: number): void => {
        if (handle.cancelled) return
        if (remaining > MAX_TIMEOUT_MS) {
          handle.inner = setTimeout(() => arm(remaining - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS)
        } else {
          handle.inner = setTimeout(fn, Math.max(0, remaining))
        }
      }
      arm(ms)
      return handle
    },
    clearTimeout(handle) {
      if (isChainedHandle(handle)) {
        handle.cancelled = true
        if (handle.inner !== undefined) clearTimeout(handle.inner)
      }
    },
  }
}

function isChainedHandle(value: unknown): value is ChainedHandle {
  return typeof value === 'object' && value !== null && 'cancelled' in value && 'inner' in value
}

/**
 * Process-unique ids: `<prefix>_<session>_<counter>`. The session token makes
 * ids from two processes (or two `createIdGenerator()` calls) distinguishable
 * without a crypto dependency.
 */
export function createIdGenerator(): IdGenerator {
  const session = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  let counter = 0
  return {
    id(prefix) {
      counter += 1
      return `${prefix}_${session}_${counter.toString(36)}`
    },
  }
}

/** Deterministic ids for tests: `tx_1`, `tx_2`, `fx_1`, ... (one counter per prefix). */
export function createSequentialIds(): IdGenerator {
  const counters = new Map<string, number>()
  return {
    id(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}_${n}`
    },
  }
}
