import { expect, it } from 'vitest'
import { demonstrateDurableOwnership } from './durable'

it('deduplicates a command and rejects a competing owner', async () => {
  const result = await demonstrateDurableOwnership()

  expect(result.first).toMatchObject({ ok: true, status: 'applied' })
  expect(result.duplicate).toMatchObject({ ok: true, status: 'replayed' })
  expect(result.competing).toMatchObject({ ok: false, code: 'LEASE_BUSY' })
})
