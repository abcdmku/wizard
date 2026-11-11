import { createHostRegistry, type HostOpenContext, type HostOpenResult } from '@openwizard/durable'
import { describe, expect, it, vi } from 'vitest'

interface Host {
  readonly id: string
}

interface OpenFailure {
  readonly ok: false
  readonly code: 'OPEN_FAILED'
}

const openFailure: OpenFailure = { ok: false, code: 'OPEN_FAILED' }

function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('deferred promise resolved before initialization')
  }
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function required<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key)
  if (value === undefined) throw new Error(`missing test value for ${String(key)}`)
  return value
}

describe('createHostRegistry', () => {
  it('single-flights the same key', async () => {
    const pending = deferred<HostOpenResult<Host, OpenFailure>>()
    const opened: string[] = []
    const host = { id: 'shared' }
    const registry = createHostRegistry({
      key: (identity: { readonly key: string; readonly request: number }) => identity.key,
      open: async (identity) => {
        opened.push(`${identity.key}:${identity.request}`)
        return pending.promise
      },
      close: vi.fn(),
    })

    const first = registry.open({ key: 'same', request: 1 })
    const second = registry.open({ key: 'same', request: 2 })

    expect(second).toBe(first)
    expect(opened).toEqual(['same:1'])
    pending.resolve({ ok: true, value: host })
    await expect(first).resolves.toEqual({ ok: true, value: host })
    await expect(second).resolves.toEqual({ ok: true, value: host })
    expect(registry.cached({ key: 'same', request: 3 })).toBe(host)
    expect(registry.values()).toEqual([host])
  })

  it('opens different keys in parallel', async () => {
    const pending = new Map<
      string,
      ReturnType<typeof deferred<HostOpenResult<Host, OpenFailure>>>
    >()
    const started: string[] = []
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (identity) => {
        started.push(identity)
        const result = deferred<HostOpenResult<Host, OpenFailure>>()
        pending.set(identity, result)
        return result.promise
      },
      close: vi.fn(),
    })

    const first = registry.open('first')
    const second = registry.open('second')
    expect(started).toEqual(['first', 'second'])

    required(pending, 'second').resolve({ ok: true, value: { id: 'second' } })
    await expect(second).resolves.toEqual({ ok: true, value: { id: 'second' } })
    required(pending, 'first').resolve({ ok: true, value: { id: 'first' } })
    await expect(first).resolves.toEqual({ ok: true, value: { id: 'first' } })
  })

  it('does not cache failed opens', async () => {
    let attempts = 0
    const host = { id: 'retry' }
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (): Promise<HostOpenResult<Host, OpenFailure>> => {
        attempts += 1
        return attempts === 1 ? openFailure : { ok: true, value: host }
      },
      close: vi.fn(),
    })

    await expect(registry.open('key')).resolves.toBe(openFailure)
    expect(registry.cached('key')).toBeUndefined()
    await expect(registry.open('key')).resolves.toEqual({ ok: true, value: host })
    expect(attempts).toBe(2)
  })

  it('ignores invalidation from an old generation', async () => {
    const contexts: HostOpenContext[] = []
    const hosts = [{ id: 'old' }, { id: 'replacement' }]
    const close = vi.fn()
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (_identity, context): Promise<HostOpenResult<Host, OpenFailure>> => {
        contexts.push(context)
        const host = hosts[contexts.length - 1]
        return host === undefined ? openFailure : { ok: true, value: host }
      },
      close,
    })
    await registry.open('key')
    const oldContext = contexts[0]
    if (oldContext === undefined) throw new Error('old host context was not captured')

    expect(oldContext.signal.aborted).toBe(false)
    oldContext.invalidate()
    expect(oldContext.signal.aborted).toBe(true)
    expect(registry.cached('key')).toBeUndefined()
    await registry.open('key')
    const replacementContext = contexts[1]
    if (replacementContext === undefined) {
      throw new Error('replacement host context was not captured')
    }
    oldContext.invalidate()
    expect(registry.cached('key')).toBe(hosts[1])
    expect(replacementContext.signal.aborted).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)

    await registry.dispose()
    expect(replacementContext.signal.aborted).toBe(true)
  })

  it('evicts only the expected cached identity', async () => {
    const host = { id: 'cached' }
    const close = vi.fn()
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (): Promise<HostOpenResult<Host, OpenFailure>> => ({ ok: true, value: host }),
      close,
    })

    await registry.open('key')
    await expect(registry.evict('key', { id: 'cached' })).resolves.toBe(false)
    expect(registry.cached('key')).toBe(host)
    await expect(registry.evict('key', host)).resolves.toBe(true)
    await expect(registry.evict('key', host)).resolves.toBe(false)
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(host)
  })

  it('aborts and awaits pending opens, then closes late successes', async () => {
    const pending = deferred<HostOpenResult<Host, OpenFailure>>()
    const close = vi.fn()
    let signal: AbortSignal | undefined
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (_identity, context) => {
        signal = context.signal
        return pending.promise
      },
      close,
    })

    const opening = registry.open('key')
    const disposing = registry.dispose()
    expect(signal?.aborted).toBe(true)

    let disposed = false
    void disposing.then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    const host = { id: 'late' }
    pending.resolve({ ok: true, value: host })
    await expect(opening).resolves.toEqual({
      ok: false,
      code: 'HOST_REGISTRY_DISPOSED',
    })
    await disposing
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(host)
    expect(registry.values()).toEqual([])
  })

  it('lets disposal win when an opener completes during disposal', async () => {
    const host = { id: 'reentrant' }
    const close = vi.fn()
    let requestDispose = (): void => undefined
    let disposing: Promise<void> | undefined
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (): Promise<HostOpenResult<Host, OpenFailure>> => {
        requestDispose()
        return { ok: true, value: host }
      },
      close,
    })
    requestDispose = () => {
      disposing = registry.dispose()
    }

    await expect(registry.open('key')).resolves.toEqual({
      ok: false,
      code: 'HOST_REGISTRY_DISPOSED',
    })
    if (disposing === undefined) throw new Error('opener did not start disposal')
    await disposing
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(host)
  })

  it('disposes cached values once and stays disposed', async () => {
    const close = vi.fn(async () => undefined)
    const registry = createHostRegistry({
      key: (identity: string) => identity,
      open: async (identity): Promise<HostOpenResult<Host, OpenFailure>> => ({
        ok: true,
        value: { id: identity },
      }),
      close,
    })
    await Promise.all([registry.open('one'), registry.open('two')])

    const first = registry.dispose()
    const second = registry.dispose()
    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(close).toHaveBeenCalledTimes(2)
    expect(registry.values()).toEqual([])
    await expect(registry.open('three')).resolves.toEqual({
      ok: false,
      code: 'HOST_REGISTRY_DISPOSED',
    })
    expect(close).toHaveBeenCalledTimes(2)
  })
})
