/**
 * Thenable handling. The interpreter treats *any* object with a callable
 * `then` as async (Promises/A+), so user hooks may return native Promises,
 * library promises or custom thenables interchangeably.
 *
 * `getThen` reads the `then` property exactly once; a throwing getter or a
 * `then()` that throws are user errors that callers must catch and report
 * through the normal result path (never escape the drain).
 *
 * @internal
 */

export type Then = (
  onFulfilled: (value: unknown) => unknown,
  onRejected: (reason: unknown) => unknown,
) => unknown

/**
 * The `then` function of a thenable, or `undefined` for plain values.
 * May throw (a hostile `then` getter): callers wrap it in the same `try` as
 * the hook call.
 */
export function getThen(value: unknown): Then | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const then: unknown = (value as { then?: unknown }).then
  return typeof then === 'function' ? (then as Then) : undefined
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return getThen(value) !== undefined
}

/**
 * Apply `fn` to `value` now if it is not a thenable, otherwise once it settles
 * (`then` is called with the original receiver). Keeps sync results
 * synchronous — the sync-commit guarantee depends on it.
 */
export function chain(value: unknown, fn: (resolved: unknown) => unknown): unknown {
  const then = getThen(value)
  if (then === undefined) return fn(value)
  return new Promise((resolve, reject) => {
    then.call(
      value,
      (v: unknown) => {
        try {
          resolve(fn(v))
        } catch (error) {
          reject(error)
        }
      },
      reject,
    )
  })
}
