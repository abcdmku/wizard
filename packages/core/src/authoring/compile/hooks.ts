/**
 * Hook adapters: the DSL's hooks are typed against `HookArgs`-compatible argument objects; the
 * runtime passes `HookArgs`. Plus the boundary unwrap and a sync-preserving `chain`.
 * @internal
 */

import { isThenable } from '../../interpreter/thenable'
import type { Hook, MaybePromise } from '../compiled'
import { isRecord } from './shared'

/** User hooks are typed against `HookArgs`-compatible arg objects; the runtime passes `HookArgs`. */
export function asHook<R>(fn: (a: never) => unknown): Hook<R> {
  return fn as unknown as Hook<R>
}

export function hookField(
  value: unknown,
  name: string,
  problem: (m: string) => void,
  set: (fn: (a: never) => unknown) => void,
): void {
  if (value === undefined) return
  if (typeof value !== 'function') {
    problem(`'${name}' must be a function`)
    return
  }
  set(value as (a: never) => unknown)
}

/** Unwrap a `BoundaryResult`; a rejection throws a coded error (the step fails with `kind: 'hook'`). */
export function unwrap(result: unknown, what: string): unknown {
  if (isRecord(result) && result.ok === true) return result.value
  const issues = isRecord(result) && Array.isArray(result.issues) ? result.issues : []
  const detail = issues
    .map((i: unknown) => (isRecord(i) && typeof i.message === 'string' ? i.message : String(i)))
    .join('; ')
  const error = Object.assign(
    new Error(`${what} rejected by boundary${detail.length > 0 ? `: ${detail}` : ''}`),
    { code: 'BOUNDARY_REJECTED', issues },
  )
  error.name = 'BoundaryError'
  throw error
}

export function chain<T, R>(value: MaybePromise<T>, then: (v: T) => R): MaybePromise<R> {
  return isThenable(value) ? (value.then(then) as Promise<R>) : then(value as T)
}
