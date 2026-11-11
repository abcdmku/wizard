import { beforeAll, describe, expect, it } from 'vitest'

import {
  command,
  createFixture,
  type Fixture,
  request,
  reviewerToken,
  view,
  waitFor,
} from './support'

let fixture: Fixture

async function refresh(): Promise<void> {
  fixture.view = await view(await request(`/api/applications/${fixture.id}`))
}

async function next(label: string): Promise<void> {
  const result = await command(fixture, `next-${label}-${Date.now()}`, 'next')
  expect(
    result.ok,
    JSON.stringify({
      result,
      id: fixture.id,
      tenant: fixture.tenant,
      current: fixture.view.workflow.current,
    }),
  ).toBe(true)
  await refresh()
}

async function setInput(step: string, patch: Record<string, unknown>): Promise<void> {
  const result = await command(fixture, `input-${step}-${Date.now()}`, 'setInput', { step, patch })
  expect(
    result.ok,
    JSON.stringify({
      result,
      id: fixture.id,
      tenant: fixture.tenant,
      current: fixture.view.workflow.current,
    }),
  ).toBe(true)
  await refresh()
}

async function waitForCurrent(step: string): Promise<void> {
  await waitFor(async () => {
    await refresh()
    return fixture.view.workflow.current === step
  })
}

describe('intake durable worker contract', () => {
  beforeAll(async () => {
    fixture = await createFixture()
  })

  it('persists a beneficial-owner draft and preserves it through back navigation', async () => {
    await command(fixture, `start-${Date.now()}`, 'start')
    await setInput('consent', {
      consentToPreviousApplication: false,
      consentToRegistry: true,
      contactEmail: 'ada@example.test',
    })
    await next('consent')
    await waitForCurrent('businessProfile')
    await setInput('businessProfile', {
      legalName: 'Analytical Engines LLC',
      registrationNumber: 'AE-001',
      legalStructure: 'incorporated',
      annualRevenue: 250_000,
      requestedAmount: 50_000,
      tradingMonths: 48,
      employeeCount: 8,
      postalCode: '60601',
      experiencedHardship: false,
    })
    await next('business')
    await waitForCurrent('beneficialOwners')
    await setInput('beneficialOwners', {
      owners: [{ id: 'owner-1', name: 'Ada Lovelace', ownershipPercent: 100 }],
    })
    expect(fixture.view.workflow.steps.beneficialOwners.input).toEqual({
      owners: [{ id: 'owner-1', name: 'Ada Lovelace', ownershipPercent: 100 }],
    })
    await command(fixture, `back-${Date.now()}`, 'back')
    await refresh()
    expect(fixture.view.workflow.steps.beneficialOwners.input).toBeDefined()
  })

  it('keeps reviewer commands tenant- and role-scoped', async () => {
    const response = await request(
      `/api/reviewer/applications/${fixture.id}/commands`,
      {
        method: 'POST',
        body: JSON.stringify({
          commandId: `review-${Date.now()}`,
          type: 'approve',
          reason: 'ready',
        }),
      },
      reviewerToken,
      'other-tenant',
    )
    expect([403, 404]).toContain(response.status)
  })
})
