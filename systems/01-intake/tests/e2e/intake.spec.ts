import { expect, test } from '@playwright/test'

test.describe('intake browser journeys', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/demo/reset', {
      data: {},
      headers: {
        authorization: 'Bearer intake-reviewer-demo',
        'x-tenant-id': 'demo-grants',
      },
    })
    expect(reset.ok()).toBe(true)
  })

  test('completes an incorporated applicant through the risk result', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Applicant name').fill('Ada Lovelace')
    await page.getByRole('button', { name: 'Start application' }).click()
    await expect(page).toHaveURL(/\/apply\/[^/]+\/consent$/)
    await expect(page.getByRole('heading', { name: 'Choose what we can prefill' })).toBeVisible()

    await page.getByLabel('Contact email').fill('ada@example.test')
    await page.getByRole('button', { name: /continue|save/i }).click()
    await expect(page.getByRole('alert')).toContainText(/registry consent/i)
    await page.getByLabel(/registry lookup/i).check()
    await page.getByRole('button', { name: /continue|save/i }).click()

    await expect(page.getByLabel('Business profile')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('Legal business name').fill('Analytical Engines LLC')
    await page.getByRole('radio', { name: 'Incorporated business' }).check()
    await page.getByLabel('Registration number').fill('AE-001')
    await page.getByLabel('Annual revenue').fill('250000')
    await page.getByLabel('Requested grant amount').fill('50000')
    await page.getByLabel('Months in operation').fill('48')
    await page.getByLabel('Number of employees').fill('8')
    await page.getByLabel('Business postal code').fill('60601')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Tell us who owns the company' })).toBeVisible()
    await page.getByLabel('Full legal name').fill('Ada Lovelace')
    await page.getByLabel('Ownership').fill('100')
    await page.getByRole('button', { name: 'Save and continue' }).click()

    await expect(page.getByRole('heading', { name: 'Add your latest financials' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByLabel('Annual expenses').fill('120000')
    await page.getByLabel('Cash on hand').fill('30000')
    await page.getByLabel('Fiscal year end').fill('2025-12-31')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Add document metadata' })).toBeVisible()
    await page.getByLabel('Add supporting documents').setInputFiles({
      name: 'financials.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('demo financial record'),
    })
    await page.getByRole('button', { name: 'Save documents' }).click()

    await expect(
      page.getByRole('heading', { name: 'Check your answers before submitting' }),
    ).toBeVisible()
    await page.getByLabel(/I confirm that the information/).check()
    await page.getByLabel('Type your full name').fill('Ada Lovelace')
    await page.getByRole('button', { name: 'Submit application' }).click()
    await expect(page.getByRole('heading', { name: 'Screening your application' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your grant was approved' })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('opens the reviewer queue through the demo seed action', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /seed and open reviewer demo/i }).click()
    await expect(page).toHaveURL(/\/reviewer$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible()
    const manualReview = page
      .getByRole('row')
      .filter({ hasText: 'Awaiting reviewer' })
      .getByRole('button', { name: /^Open .* application$/ })
    await expect(manualReview).toBeVisible()
    await manualReview.click()
    await expect(page).toHaveURL(/\/reviewer\/[^/]+$/)
    await expect(
      page.getByText(/internal scores and screening inputs are not exposed/i),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Record a decision' })).toBeVisible()
    await page.getByLabel('Decision note').fill('The application meets the grant criteria.')
    await page.getByRole('button', { name: 'Record decision' }).click()
    await expect(page.getByRole('heading', { name: 'Decision recorded' })).toBeVisible()
    await expect(page.getByText('Approved', { exact: true })).toHaveCount(2)
  })
})
