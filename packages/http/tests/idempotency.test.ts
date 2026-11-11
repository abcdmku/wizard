import { expect, it } from 'vitest'
import { createHTTP, createMemoryIdempotencyStore } from '../src'
import { auth, call, orders } from './fixtures/orders'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it.each([
  ['expiration', 'complete'],
  ['expiration', 'release'],
  ['eviction', 'complete'],
  ['eviction', 'release'],
] as const)(
  'fences an old producer %s followed by %s from its replacement claim',
  async (replacement, outcome) => {
    let now = 0
    const oldEntered = deferred()
    const newEntered = deferred()
    const oldWork = deferred()
    const newWork = deferred()
    const store = createMemoryIdempotencyStore({
      ttlMs: 10,
      maxEntries: replacement === 'eviction' ? 1 : 100,
      now: () => now,
    })
    const http = createHTTP(orders, {
      auth,
      access: { run: ['create'], context: ['orderId'] },
      idempotency: store,
      runs: {
        get: () => undefined,
        create: async ({ input }) => {
          if (input.orderId === 'old') {
            oldEntered.resolve()
            await oldWork.promise
            if (outcome === 'release') throw new Error('old producer failed')
          } else if (input.orderId === 'new') {
            newEntered.resolve()
            await newWork.promise
          }
          return orders.create(input, { instanceId: input.orderId })
        },
      },
    })
    const create = (orderId: string, key = 'shared') =>
      http.fetch(
        call('/api/orders', {
          token: 'alice',
          body: { orderId, secret: 's' },
          headers: { 'idempotency-key': key },
        }),
      )
    const old = create('old')
    await oldEntered.promise
    if (replacement === 'expiration') now = 11
    else expect((await create('other', 'evict')).status).toBe(201)
    const newer = create('new')
    await newEntered.promise
    oldWork.resolve()
    expect((await old).status).toBe(outcome === 'complete' ? 201 : 500)

    const pending = await create('new')
    expect(pending.status).toBe(409)
    expect(await pending.json()).toMatchObject({ code: 'IDEMPOTENCY_PENDING' })
    const conflict = await create('old')
    expect(conflict.status).toBe(422)
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    newWork.resolve()
    const first = await newer
    const text = await first.text()
    expect(JSON.parse(text)).toMatchObject({ data: { context: { orderId: 'new' } } })
    const replay = await create('new')
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(await replay.text()).toBe(text)
  },
)
