/**
 * Store — the persistence port. One snapshot per key; the value is whatever
 * `toSnapshot()` produced (after `redact`, if configured), JSON-checked right
 * before `set` (a write of a non-JSON snapshot never reaches the store —
 * `onPersistError` / `persist.failed`). Single-owner in v0.1: one live wizard
 * per key, no compare-and-swap or lease.
 *
 * Implementations are the host's job (Redis, Postgres, KV, ...); core ships
 * `createMemoryStore()` for tests and single-process apps. Keys should be
 * tenant-scoped by the host (see SECURITY.md).
 *
 * @public
 */

export interface Store {
  /** `null` when the key is unknown. */
  get(key: string): Promise<unknown | null>
  set(key: string, snapshot: unknown): Promise<void>
  delete(key: string): Promise<void>
}
