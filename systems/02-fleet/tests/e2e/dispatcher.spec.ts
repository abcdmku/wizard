import { expect, test } from '@playwright/test'
import { compose } from '../fixtures/compose'
import { fleetEnv } from '../fixtures/env'
import { waitForHealth } from '../fixtures/http'

test('dispatcher sees a seeded delivery and submits a scoped intervention', async ({ page }) => {
  test.setTimeout(90_000)
  const interventionBodies: string[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    if (request.url().includes('/interventions')) {
      const body = request.postData()
      if (body !== null) interventionBodies.push(body)
    }
    await route.continue({
      headers: {
        ...request.headers(),
        authorization: `Bearer ${fleetEnv.dispatchToken}`,
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: /open dispatch/i }).click()
  await expect(page.getByRole('heading', { name: /lakeshore logistics/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /escalation queue/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /operator controls/i })).toBeVisible()

  const action = page.getByRole('button', { name: /place on hold/i }).first()
  await expect(action).toBeVisible()
  await action.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('Cold-chain drill')
  await dialog.getByRole('button', { name: /place on hold/i }).click()
  await expect(page.getByText(/accepted for/i)).toBeVisible()

  expect(interventionBodies).toHaveLength(1)
  expect(interventionBodies[0]).not.toContain('tenantId')
  expect(interventionBodies[0]).not.toContain('scope')
  expect(interventionBodies[0]).toContain('hold')
  expect(interventionBodies[0]).toMatch(/"expectedVersion":\{"epoch":\d+,"seq":\d+\}/)

  const connection = page.getByRole('banner').getByRole('status')
  await expect(connection).toContainText('Live')
  await compose('restart', 'fleet-api')
  await waitForHealth(60_000)
  await expect(connection).toContainText('Live', { timeout: 45_000 })
  await expect(page.getByRole('heading', { name: /lakeshore logistics/i })).toBeVisible()
})
