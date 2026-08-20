import { createRun } from '@openwizard/core'
import { expect, test, vi } from 'vitest'
import { type Deps, orderFlow } from './order-definition'

test('prepares an order', async () => {
  const reserve = vi.fn(async () => ({ reservationId: 'r-9' }))
  const deps: Deps = {
    inventory: {
      reserve,
      release: vi.fn(async () => undefined),
    },
  }
  const run = createRun(orderFlow, {
    context: { orderId: 'o-42', total: 42 },
    deps,
  })

  await run.start()

  expect(await run.awaitResult()).toMatchObject({
    status: 'done',
    output: { orderId: 'o-42' },
  })
  expect(reserve).toHaveBeenCalledWith('o-42')
  expect(run.log().at(-1)?.type).toBe('flow.done')
})
