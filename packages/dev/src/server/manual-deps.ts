/** A service call that waits for a person to answer it. */
export interface PendingCall {
  readonly id: string
  /** The path the step called, such as `payments.refund`. */
  readonly name: string
  readonly args: readonly unknown[]
}

/** Services whose every call waits for an answer from the UI. */
export interface ManualDeps {
  /** Pass this as `deps`. Any path on it is a function that returns a promise. */
  readonly deps: object
  pending(): readonly PendingCall[]
  /** Settles a call with a return value. False when the id is unknown. */
  resolve(id: string, value: unknown): boolean
  /** Settles a call by throwing. False when the id is unknown. */
  reject(id: string, message: string): boolean
  /** Rejects every open call, so no step waits on a run that was removed. */
  dispose(): void
}

interface Open extends PendingCall {
  readonly settle: (value: unknown) => void
  readonly fail: (error: Error) => void
}

/** Turns an argument into JSON the UI can show. A function or a cycle becomes a short label. */
function printable(value: unknown): unknown {
  const seen = new WeakSet<object>()
  const walk = (item: unknown): unknown => {
    if (typeof item === 'function') return '[function]'
    if (typeof item === 'bigint') return `${item}n`
    if (typeof item === 'symbol' || item === undefined)
      return item === undefined ? null : '[symbol]'
    if (typeof item !== 'object' || item === null) return item
    if (seen.has(item)) return '[circular]'
    seen.add(item)
    if (Array.isArray(item)) return item.map(walk)
    if (item instanceof Date) return item.toISOString()
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]))
  }
  return walk(value)
}

/**
 * Stand-in services for a run with no real ones. `deps.orders.find('o-1')` records a call named
 * `orders.find` and returns a promise the UI settles. `real` supplies the services that exist;
 * only the missing ones wait.
 */
export function createManualDeps(onChange: () => void, real: object = {}): ManualDeps {
  const open = new Map<string, Open>()
  let nextId = 1

  const call = (name: string, args: readonly unknown[]): Promise<unknown> =>
    new Promise((settle, fail) => {
      const id = `call-${nextId++}`
      open.set(id, { id, name, args: args.map(printable), settle, fail })
      onChange()
    })

  const at = (path: readonly string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key) {
        // A promise check or a serializer must not see a service here.
        if (typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined
        return at([...path, key])
      },
      apply: (_target, _self, args) => call(path.join('.'), args),
    })

  const deps = new Proxy(real, {
    get(target, key, receiver) {
      if (typeof key === 'symbol' || key === 'then' || key === 'toJSON')
        return Reflect.get(target, key, receiver)
      return key in target ? Reflect.get(target, key, receiver) : at([key])
    },
  })

  const take = (id: string): Open | undefined => {
    const entry = open.get(id)
    if (entry !== undefined) open.delete(id)
    return entry
  }

  return {
    deps,
    pending: () => [...open.values()].map(({ id, name, args }) => ({ id, name, args })),
    resolve(id, value) {
      const entry = take(id)
      entry?.settle(value)
      if (entry !== undefined) onChange()
      return entry !== undefined
    },
    reject(id, message) {
      const entry = take(id)
      entry?.fail(new Error(message))
      if (entry !== undefined) onChange()
      return entry !== undefined
    },
    dispose() {
      for (const entry of open.values()) entry.fail(new Error('The run was removed.'))
      open.clear()
    },
  }
}
