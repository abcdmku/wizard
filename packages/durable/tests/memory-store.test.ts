import { createMemoryDurableStore } from '@openwizard/durable'
import { durableStoreContract } from '@openwizard/durable/testing'
import { expect, it } from 'vitest'

durableStoreContract('memory store', (options) => ({ store: createMemoryDurableStore(options) }))

it('lists the keys it holds and forgets them on clear', async () => {
  const store = createMemoryDurableStore()
  await store.acquire('run-b', 'owner')
  await store.acquire('run-a', 'owner')
  expect(store.keys()).toEqual(['run-a', 'run-b'])
  store.clear()
  expect(store.keys()).toEqual([])
  expect(await store.read('run-a')).toBeNull()
})
