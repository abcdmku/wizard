/**
 * The result returned by a host opener. Expected open failures stay in the
 * caller-defined `E` branch.
 *
 * @public
 */
export type HostOpenResult<T, E extends { readonly ok: false }> =
  | { readonly ok: true; readonly value: T }
  | E

/**
 * Lifecycle controls for one host generation. The signal aborts when that
 * generation is invalidated, evicted, or disposed. `invalidate` only removes
 * the generation opened with this context, so an old lease-loss callback
 * cannot remove its replacement.
 *
 * @public
 */
export interface HostOpenContext {
  readonly signal: AbortSignal
  invalidate(): void
}

/**
 * Returned when an open loses a race with registry disposal or starts after
 * disposal.
 *
 * @public
 */
export interface HostRegistryDisposed {
  readonly ok: false
  readonly code: 'HOST_REGISTRY_DISPOSED'
}

/**
 * The result returned by `createHostRegistry().open`. The registry adds its
 * own disposed failure without manufacturing the caller-defined `E`.
 *
 * @public
 */
export type HostRegistryOpenResult<T, E extends { readonly ok: false }> =
  | HostOpenResult<T, E>
  | HostRegistryDisposed

interface Generation {
  readonly key: string
  readonly controller: AbortController
  closePromise: Promise<void> | undefined
}

interface Pending<T, E extends { readonly ok: false }> {
  readonly generation: Generation
  readonly promise: Promise<HostRegistryOpenResult<T, E>>
}

interface Cached<T> {
  readonly generation: Generation
  readonly value: T
}

const disposedResult: HostRegistryDisposed = {
  ok: false,
  code: 'HOST_REGISTRY_DISPOSED',
}

/**
 * Create a keyed host cache that removes entries only through invalidation,
 * expected eviction, or registry disposal. Opens for one key share a promise.
 * Different keys open independently. The registry does not choose keys,
 * discover hosts, retry, or interpret open failures.
 *
 * @public
 */
export function createHostRegistry<I, T, E extends { readonly ok: false }>(options: {
  readonly key: (identity: I) => string
  readonly open: (identity: I, context: HostOpenContext) => Promise<HostOpenResult<T, E>>
  readonly close: (value: T) => void | PromiseLike<void>
}): {
  open(identity: I): Promise<HostRegistryOpenResult<T, E>>
  cached(identity: I): T | undefined
  values(): readonly T[]
  evict(identity: I, expected: T): Promise<boolean>
  dispose(): Promise<void>
} {
  const pending = new Map<string, Pending<T, E>>()
  const cached = new Map<string, Cached<T>>()
  const closing = new Set<Promise<void>>()
  let disposed = false
  let disposePromise: Promise<void> | undefined

  const startClose = (generation: Generation, value: T): Promise<void> => {
    if (generation.closePromise !== undefined) return generation.closePromise

    let closePromise: Promise<void>
    try {
      closePromise = Promise.resolve(options.close(value))
    } catch (error) {
      closePromise = Promise.reject(error)
    }
    generation.closePromise = closePromise
    closing.add(closePromise)
    void closePromise.then(
      () => closing.delete(closePromise),
      () => closing.delete(closePromise),
    )
    return closePromise
  }

  const invalidate = (generation: Generation): void => {
    if (generation.controller.signal.aborted) return
    const active = cached.get(generation.key)
    if (active?.generation === generation) cached.delete(generation.key)
    generation.controller.abort()
    if (active?.generation === generation) {
      void startClose(generation, active.value).catch(() => undefined)
    }
  }

  const settleOpen = async (
    generation: Generation,
    opened: Promise<HostOpenResult<T, E>>,
  ): Promise<HostRegistryOpenResult<T, E>> => {
    let result: HostOpenResult<T, E>
    try {
      result = await opened
    } catch (error) {
      if (pending.get(generation.key)?.generation === generation) {
        pending.delete(generation.key)
      }
      if (disposed) return disposedResult
      throw error
    }

    if (pending.get(generation.key)?.generation === generation) {
      pending.delete(generation.key)
    }
    if (!result.ok) return disposed ? disposedResult : result

    if (disposed || generation.controller.signal.aborted) {
      await startClose(generation, result.value)
      return disposed ? disposedResult : result
    }

    cached.set(generation.key, { generation, value: result.value })
    return result
  }

  const open = (identity: I): Promise<HostRegistryOpenResult<T, E>> => {
    if (disposed) return Promise.resolve(disposedResult)

    const key = options.key(identity)
    const present = cached.get(key)
    if (present !== undefined) return Promise.resolve({ ok: true, value: present.value })

    const inFlight = pending.get(key)
    if (inFlight !== undefined) return inFlight.promise

    const generation: Generation = {
      key,
      controller: new AbortController(),
      closePromise: undefined,
    }
    const context: HostOpenContext = {
      signal: generation.controller.signal,
      invalidate: () => invalidate(generation),
    }

    let resolveResult = (_result: HostRegistryOpenResult<T, E>): void => undefined
    let rejectResult = (_reason?: unknown): void => undefined
    const promise = new Promise<HostRegistryOpenResult<T, E>>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    pending.set(key, { generation, promise })

    let opened: Promise<HostOpenResult<T, E>>
    try {
      opened = options.open(identity, context)
    } catch (error) {
      opened = Promise.reject(error)
    }
    void settleOpen(generation, opened).then(resolveResult, rejectResult)
    return promise
  }

  const dispose = (): Promise<void> => {
    if (disposePromise !== undefined) return disposePromise
    disposed = true

    const tasks: Promise<unknown>[] = [...closing]
    for (const entry of pending.values()) {
      entry.generation.controller.abort()
      tasks.push(entry.promise)
    }
    pending.clear()
    for (const entry of cached.values()) {
      entry.generation.controller.abort()
      tasks.push(startClose(entry.generation, entry.value))
    }
    cached.clear()

    disposePromise = waitForAll(tasks)
    return disposePromise
  }

  return {
    open,
    cached(identity) {
      return cached.get(options.key(identity))?.value
    },
    values() {
      return Array.from(cached.values(), (entry) => entry.value)
    },
    async evict(identity, expected) {
      const key = options.key(identity)
      const entry = cached.get(key)
      if (entry === undefined || !Object.is(entry.value, expected)) return false

      cached.delete(key)
      entry.generation.controller.abort()
      await startClose(entry.generation, entry.value)
      return true
    },
    dispose,
  }
}

async function waitForAll(tasks: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks)
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason
  }
}
