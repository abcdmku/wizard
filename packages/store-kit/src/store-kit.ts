/**
 * The checks every `DurableStore` adapter runs before it touches storage: argument validation,
 * store options, and the predicates that decide whether a lease or claim is still held.
 *
 * This package is private. `@openwizard/durable` and `@openwizard/drizzle` bundle it into their
 * build output, so both stores reject and accept the same input without a published dependency.
 * The file is not named `index.ts` on purpose: the API snapshot and export-table scripts treat
 * `packages/<name>/src/index.ts` as a public entry.
 */
export {
  makeStoreConfiguration,
  readLimit,
  readNow,
  readTtl,
  type StoreConfiguration,
  type StoreOptions,
} from './configuration'
export {
  type NormalizedCommitInput,
  normalizeCommitInput,
  normalizeDedupeClaimInput,
  normalizeLease,
  normalizeTimerClaimInput,
  normalizeVersion,
  requireIdentifier,
} from './input'
export {
  compareVersion,
  type DedupeClaimView,
  type HeldLease,
  isCompletableDedupe,
  isCompletableTimer,
  isCurrentLease,
  isOpenClaim,
  nextCounter,
  sameVersion,
  serializeJson,
  type TimerClaimView,
} from './predicates'
