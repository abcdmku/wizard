import { expect, it } from 'vitest'
import { projectCheckout } from './projection'

it('omits server-only context from a projection', () => {
  const clientState = projectCheckout()

  expect(clientState.context).toEqual({ total: 129.5 })
  expect(Object.hasOwn(clientState.context, 'cartId')).toBe(false)
  expect(Object.hasOwn(clientState.steps.payment, 'input')).toBe(false)
})
