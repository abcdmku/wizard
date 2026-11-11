/**
 * `useRun(create, deps?)` — the component owns a `Run` or a `Mirror`: created once, during
 * render (so server rendering and the first client render have it), disposed when the component
 * unmounts for real.
 *
 * Every created source holds a lease that expires on the next macrotask unless a committed
 * effect claims it. That one rule covers StrictMode (its simulated unmount releases, the
 * re-mount claims again before the lease expires, so the run survives), renders React throws
 * away (React 18 StrictMode double render, an abandoned concurrent render: never claimed, so
 * disposed instead of leaked) and server rendering (effects never run there). A commit that
 * arrives after its lease expired renders once more with a fresh source.
 *
 * @packageDocumentation
 */

import { type DependencyList, useEffect, useReducer, useRef } from 'react'

/** What `useRun` can own: `Run`, `Mirror`. */
interface Disposable {
  dispose(): void
}

interface Lease<S extends Disposable> {
  readonly source: S
  readonly deps: DependencyList
  disposed: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

function lease<S extends Disposable>(source: S, deps: DependencyList): Lease<S> {
  const created: Lease<S> = { source, deps, disposed: false, timer: undefined }
  release(created)
  return created
}

function release(held: Lease<Disposable>): void {
  held.timer = setTimeout(() => {
    held.disposed = true
    held.source.dispose()
  }, 0)
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}

/**
 * Own a run or a Mirror inside a component, StrictMode-safe: `create` runs during the first
 * render (and again when a value in `deps` changes, disposing the previous source); the source
 * is disposed after the component unmounts. Start the run in an effect — `start()` on a started
 * run is a no-op result, so StrictMode's effect replay is harmless.
 *
 * ```tsx
 * const run = useRun(() => checkout.create({ cartId }), [cartId])
 * useEffect(() => void run.start(), [run])
 * return <ow.Provider source={run}>…</ow.Provider>
 * ```
 * @public
 */
export function useRun<S extends { dispose(): void }>(
  create: () => S,
  deps: DependencyList = [],
): S {
  const held = useRef<Lease<S> | null>(null)
  const [, renewExpired] = useReducer((n: number) => n + 1, 0)
  let current = held.current
  if (current === null || current.disposed || !sameDeps(current.deps, deps)) {
    current = lease(create(), deps)
    held.current = current
  }
  const claimed = current
  useEffect(() => {
    if (claimed.disposed) {
      renewExpired()
      return
    }
    clearTimeout(claimed.timer)
    return () => release(claimed)
  }, [claimed])
  return claimed.source
}
