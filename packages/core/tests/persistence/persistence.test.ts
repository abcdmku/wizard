import { describe, expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createPersistenceDriver } from '../../src/persistence/driver'
import { createMemoryStore } from '../../src/persistence/memory-store'
import type { Store } from '../../src/persistence/store'
import { createWizardRuntime, type WizardRuntimeOptions } from '../../src/wizard/runtime'
import type { Snapshot } from '../../src/wizard/snapshot'
import { createToyMachine, flow, initialState } from '../helpers/fake-machine'

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

const twoViews = flow({
  steps: {
    a: { kind: 'view', next: { kind: 'static', targets: ['b'] } },
    b: { kind: 'view', next: { kind: 'static', targets: ['end'] } },
    end: { kind: 'final' },
  },
})

/** A store that records every call and can be made slow / failing. */
function recordingStore(
  opts: { failOn?: number } = {},
): Store & { writes: unknown[]; deletes: string[]; calls: number } {
  const inner = createMemoryStore()
  const rec = {
    writes: [] as unknown[],
    deletes: [] as string[],
    calls: 0,
    get: (key: string) => inner.get(key),
    async set(key: string, snapshot: unknown) {
      rec.calls += 1
      if (opts.failOn === rec.calls) throw new Error('store down')
      rec.writes.push(snapshot)
      await inner.set(key, snapshot)
    },
    async delete(key: string) {
      rec.deletes.push(key)
      await inner.delete(key)
    },
  }
  return rec
}

function make(opts: Partial<WizardRuntimeOptions> & { store: Store }) {
  const sched = createTestScheduler({ now: 100 })
  const wizard = createWizardRuntime(twoViews, {
    context: { secret: 'hunter2', tenant: 't' },
    machine: createToyMachine(),
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'w1',
    ...opts,
  })
  return { wizard, sched }
}

describe('createMemoryStore', () => {
  it('stores JSON copies: get() returns a fresh, serialized value; delete removes; keys lists', async () => {
    const store = createMemoryStore()
    expect(await store.get('nope')).toBeNull()
    const value = { a: 1, when: undefined, nested: { list: [1, 2] } }
    await store.set('k', value)
    const back = await store.get('k')
    expect(back).toEqual({ a: 1, nested: { list: [1, 2] } })
    expect(back).not.toBe(value)
    expect(store.keys()).toEqual(['k'])
    await store.delete('k')
    expect(await store.get('k')).toBeNull()
    await expect(store.set('bad', undefined)).rejects.toBeInstanceOf(TypeError)
  })
})

describe('persistence via the wizard runtime', () => {
  it("autoSave 'change' writes one snapshot per drain that changed state (debounce 0)", async () => {
    const store = recordingStore()
    const { wizard } = make({ store, key: 'k' })
    await wizard.start()
    await wizard.next()
    await settle()
    expect(store.writes).toHaveLength(2)
    expect((store.writes[1] as Snapshot).state.current).toBe('b')
    expect(((await store.get('k')) as Snapshot).seq).toBe(wizard.getState().seq)
    // A no-op command changes nothing → no write.
    await wizard.runReady()
    await settle()
    expect(store.writes).toHaveLength(2)
  })

  it('debounceMs coalesces bursts into a single write with the latest state', async () => {
    const store = recordingStore()
    const { wizard, sched } = make({ store, key: 'k', debounceMs: 100 })
    await wizard.start()
    await wizard.setInput('a', { x: 1 })
    await wizard.setInput('a', { x: 2 })
    await settle()
    expect(store.writes).toHaveLength(0)
    sched.advance(99)
    await settle()
    expect(store.writes).toHaveLength(0)
    sched.advance(1)
    await settle()
    expect(store.writes).toHaveLength(1)
    expect((store.writes[0] as Snapshot).state.steps.a!.input).toEqual({ x: 2 })
  })

  it('save() flushes a pending debounced write immediately and resolves after the store acknowledged', async () => {
    const store = recordingStore()
    const { wizard, sched } = make({ store, key: 'k', debounceMs: 5_000 })
    await wizard.start()
    expect(store.writes).toHaveLength(0)
    await wizard.save()
    expect(store.writes).toHaveLength(1)
    sched.advance(10_000)
    await settle()
    expect(store.writes).toHaveLength(1) // the debounce timer was cancelled by save()
  })

  it("autoSave 'off' only writes on save(); key defaults to the instance id", async () => {
    const store = recordingStore()
    const { wizard } = make({ store, autoSave: 'off' })
    await wizard.start()
    await settle()
    expect(store.writes).toHaveLength(0)
    await wizard.save()
    expect(await store.get('w1')).toMatchObject({ instanceId: 'w1', seq: 3 })
  })

  it('redact() runs on the snapshot before it reaches the store', async () => {
    const store = recordingStore()
    const { wizard } = make({
      store,
      key: 'k',
      redact: (s) => ({
        ...s,
        state: { ...s.state, context: { ...(s.state.context as object), secret: '[redacted]' } },
      }),
    })
    await wizard.start()
    await settle()
    expect((store.writes[0] as Snapshot).state.context).toEqual({
      secret: '[redacted]',
      tenant: 't',
    })
    // The live snapshot is untouched.
    expect(wizard.getSnapshot().state.context).toEqual({ secret: 'hunter2', tenant: 't' })
  })

  it('clearOnDone deletes the key once the flow is done', async () => {
    const store = recordingStore()
    const { wizard } = make({ store, key: 'k', clearOnDone: true })
    await wizard.start()
    await wizard.next()
    await settle()
    expect(store.writes).toHaveLength(2)
    await wizard.next() // b → end → done
    await settle()
    expect(store.deletes).toEqual(['k'])
    expect(await store.get('k')).toBeNull()
  })

  it('reports store failures on the auto-save path through onPersistError; save() rejects', async () => {
    const store = recordingStore({ failOn: 1 })
    const errors: unknown[] = []
    const { wizard } = make({ store, key: 'k', onPersistError: (e) => errors.push(e) })
    await wizard.start()
    await settle()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('store down')
    // Later writes still work.
    await wizard.next()
    await settle()
    expect(store.writes).toHaveLength(1)
    const failing = recordingStore({ failOn: 1 })
    const w2 = make({ store: failing, key: 'z', autoSave: 'off' })
    await expect(w2.wizard.save()).rejects.toThrow('store down')
  })

  it('save() without a store is a no-op; dispose flushes a pending debounced write', async () => {
    const sched = createTestScheduler()
    const wizard = createWizardRuntime(twoViews, {
      context: {},
      machine: createToyMachine(),
      initialState,
      scheduler: sched,
    })
    await expect(wizard.save()).resolves.toBeUndefined()

    const store = recordingStore()
    const { wizard: w2 } = make({ store, key: 'k', debounceMs: 1_000 })
    await w2.start()
    w2.dispose()
    await settle()
    expect(store.writes).toHaveLength(1)
  })

  it('a child never persists on its own; the root snapshot carries it', async () => {
    const child = flow({ name: 'child', steps: { w: { kind: 'wait', hooks: { on: {} } } } })
    const parent = flow({
      name: 'parent',
      steps: {
        f: { kind: 'flow', child, next: { kind: 'static', targets: ['end'] } },
        end: { kind: 'final' },
      },
    })
    const store = recordingStore()
    const sched = createTestScheduler()
    const wizard = createWizardRuntime(parent, {
      context: {},
      machine: createToyMachine(),
      initialState,
      scheduler: sched,
      store,
      key: 'root',
    })
    await wizard.start()
    await settle()
    expect(store.writes.length).toBeGreaterThan(0)
    const last = store.writes.at(-1) as Snapshot
    expect(last.children.f?.state.status).toBe('waiting')
    expect(((await store.get('root')) as Snapshot).children.f?.flow.name).toBe('child')
  })
})

describe('createPersistenceDriver (unit)', () => {
  it('serializes writes so a slow earlier write cannot overwrite a newer one', async () => {
    const order: number[] = []
    let seq = 0
    const gates: Array<() => void> = []
    const store: Store = {
      get: async () => null,
      set: (_k, snap) =>
        new Promise<void>((resolve) => {
          gates.push(() => {
            order.push((snap as Snapshot).seq)
            resolve()
          })
        }),
      delete: async () => {},
    }
    const sched = createTestScheduler()
    const driver = createPersistenceDriver({
      store,
      key: 'k',
      autoSave: 'change',
      debounceMs: 0,
      scheduler: sched,
      getSnapshot: () => ({ seq: ++seq, state: { status: 'waiting' } }) as unknown as Snapshot,
    })
    driver.notify('change')
    driver.notify('change')
    await settle()
    // Only the first write has started; the second waits for it.
    expect(gates).toHaveLength(1)
    gates[0]!()
    await settle()
    expect(gates).toHaveLength(2)
    gates[1]!()
    await driver.flush()
    expect(order).toEqual([1, 2])
    expect(driver.hasPending()).toBe(false)
  })

  it('captures the snapshot when notify()/save()/the debounce timer fires — not when a blocked write finally starts', async () => {
    let current = { seq: 1, state: { status: 'waiting' } } as unknown as Snapshot
    const written: number[] = []
    const gates: Array<() => void> = []
    const store: Store = {
      get: async () => null,
      set: (_k, snap) =>
        new Promise<void>((resolve) => {
          gates.push(() => {
            written.push((snap as Snapshot).seq)
            resolve()
          })
        }),
      delete: async () => {},
    }
    const sched = createTestScheduler()
    const driver = createPersistenceDriver({
      store,
      key: 'k',
      autoSave: 'change',
      debounceMs: 0,
      scheduler: sched,
      getSnapshot: () => current,
    })
    driver.notify('change') // captures seq 1; the write blocks
    current = { seq: 2, state: { status: 'waiting' } } as unknown as Snapshot
    driver.notify('change') // captures seq 2 while write 1 is blocked
    current = { seq: 3, state: { status: 'waiting' } } as unknown as Snapshot
    const saved = driver.save() // captures seq 3 immediately
    current = { seq: 99, state: { status: 'waiting' } } as unknown as Snapshot
    await settle()
    expect(gates).toHaveLength(1)
    gates[0]!()
    await settle()
    gates[1]!()
    await settle()
    gates[2]!()
    await saved
    expect(written).toEqual([1, 2, 3])

    // Debounce: the snapshot is the one current when the timer fires.
    const bounced = createPersistenceDriver({
      store,
      key: 'k',
      autoSave: 'change',
      debounceMs: 50,
      scheduler: sched,
      getSnapshot: () => current,
    })
    bounced.notify('change')
    current = { seq: 100, state: { status: 'waiting' } } as unknown as Snapshot
    sched.advance(50)
    await settle()
    gates[3]!()
    await bounced.flush()
    expect(written).toEqual([1, 2, 3, 100])
  })
})
