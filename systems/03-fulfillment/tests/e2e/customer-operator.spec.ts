import { CustomerOrderResponseSchema } from '@fulfillment/contracts'
import { expect, test } from '@playwright/test'

test.describe('customer and operator journey', () => {
  test('creates an order, reaches fraud review, and approves it', async ({ browser }) => {
    test.setTimeout(90_000)
    const customer = await browser.newPage()
    const operator = await browser.newPage()

    try {
      await customer.goto('/')
      await expect(customer.getByRole('heading', { name: 'Your orders, Alice' })).toBeVisible()
      await expect(customer.getByText('API connected')).toBeVisible()
      await customer.getByRole('button', { name: 'New order' }).click()
      await customer.getByLabel('Recipient').fill('Fulfillment QA')
      const createResponsePromise = customer.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/customer/orders',
      )
      await customer.getByRole('button', { name: 'Create order' }).click()

      const createResponse = await createResponsePromise
      expect(createResponse.ok()).toBe(true)
      const createdOrder = CustomerOrderResponseSchema.parse(await createResponse.json()).order
      const orderNumber = `LS-${createdOrder.id.slice(0, 8).toUpperCase()}`
      const orderHeading = customer.getByRole('heading', { name: orderNumber, exact: true })
      await expect(orderHeading).toBeVisible()
      await expect(customer.getByRole('status')).toContainText('Order created')

      await operator.goto('/ops/orders')
      await expect(
        operator.getByRole('heading', { name: 'Fulfillment control room' }),
      ).toBeVisible()
      const search = operator.getByPlaceholder('Search order or customer')
      await search.fill(orderNumber)

      await expect
        .poll(
          async () => {
            await operator.getByRole('button', { name: 'Refresh orders' }).click()
            await search.fill(orderNumber)
            return await operator.getByRole('heading', { name: 'Fraud review' }).count()
          },
          { timeout: 60_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe(1)

      await expect(operator.getByText('Decision required')).toBeVisible()
      await operator.getByRole('button', { name: /Approve LS-/ }).click()
      await expect(operator.getByRole('status')).toContainText('approved and moved to shipping')

      const orderDetail = operator.getByRole('article', { name: orderNumber })
      await expect
        .poll(
          async () => {
            await operator.getByRole('button', { name: 'Refresh orders' }).click()
            await search.fill(orderNumber)
            return await orderDetail.getByText('Shipped', { exact: true }).count()
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe(1)

      await customer.getByRole('button', { name: 'Refresh data' }).click()
      await expect(customer.getByRole('heading', { name: orderNumber, exact: true })).toBeVisible()
      await expect(customer.getByLabel('Shipment tracking')).toBeVisible()
    } finally {
      await customer.close()
      await operator.close()
    }
  })
})
