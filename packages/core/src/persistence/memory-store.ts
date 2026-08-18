/**
 * In-memory `Store`. Values go through a JSON round trip on `set` so the
 * store behaves like a real serializer: functions, `undefined` properties,
 * class instances and Dates do not survive — exactly what a database would do,
 * which makes resume bugs visible in tests instead of in production.
 *
 * @public
 */

import type { Store } from './store'

/**
 * What `createMemoryStore()` returns: a `Store` plus `keys()` / `clear()` for tests and diagnostics.
 * @public
 */
export interface MemoryStore extends Store {
  /** Stored keys (tests / diagnostics). */
  keys(): readonly string[]
  clear(): void
}

/**
 * In-memory `Store` (JSON round-trip on every `set`/`get`) for tests, examples and single-process use.
 *
 * @public
 */
export function createMemoryStore(): MemoryStore {
  const data = new Map<string, string>()
  return {
    async get(key) {
      const raw = data.get(key)
      return raw === undefined ? null : JSON.parse(raw)
    },
    async set(key, snapshot) {
      const raw: unknown = JSON.stringify(snapshot)
      if (typeof raw !== 'string')
        throw new TypeError(`store.set('${key}'): value is not JSON-serializable`)
      data.set(key, raw)
    },
    async delete(key) {
      data.delete(key)
    },
    keys: () => Array.from(data.keys()),
    clear: () => data.clear(),
  }
}
