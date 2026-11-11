import { describe, expect, it } from 'vitest'
import {
  BeneficialOwnersInputSchema,
  type BusinessProfileInput,
  BusinessProfileInputSchema,
  type IntakeContext,
} from '../../shared/index.js'
import { evaluateEligibility } from './routing.js'

const profile = {
  legalName: 'Threshold Bakery',
  legalStructure: 'sole-proprietor',
  annualRevenue: 100_000,
  requestedAmount: 100_000,
  tradingMonths: 6,
  employeeCount: 4,
  postalCode: '60601',
  experiencedHardship: false,
  revenueDropPercent: 19,
} satisfies BusinessProfileInput

function context(overrides: Partial<BusinessProfileInput> = {}): IntakeContext {
  return {
    applicationId: 'routing-test',
    tenantId: 'demo-grants',
    applicantId: 'routing-applicant',
    applicantName: 'Threshold Bakery',
    businessProfile: { ...profile, ...overrides },
    changeRequestCount: 0,
  }
}

describe('intake eligibility routing', () => {
  it.each([
    ['standard', {}, 'standard'],
    ['hardship at a 20 percent revenue drop', { revenueDropPercent: 20 }, 'hardship'],
    ['hardship when explicitly reported', { experiencedHardship: true }, 'hardship'],
    ['appeal below six trading months', { tradingMonths: 5 }, 'appeal'],
    ['appeal above annual revenue', { requestedAmount: 100_001 }, 'appeal'],
  ] as const)('%s', (_name, overrides, expected) => {
    expect(evaluateEligibility(context(overrides)).path).toBe(expected)
  })
})

describe('intake form issue paths', () => {
  it('attaches field and cross-field issues to their form controls', () => {
    const business = BusinessProfileInputSchema.safeParse({
      ...profile,
      legalName: '',
      legalStructure: 'incorporated',
    })
    expect(business.success).toBe(false)
    if (business.success) throw new Error('Expected the business profile to fail validation')
    expect(business.error.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['legalName', 'registrationNumber']),
    )

    const owners = BeneficialOwnersInputSchema.safeParse({
      owners: [{ id: 'owner-1', name: 'Avery Patel', ownershipPercent: 90 }],
    })
    expect(owners.success).toBe(false)
    if (owners.success) throw new Error('Expected beneficial owners to fail validation')
    expect(owners.error.issues.map((issue) => issue.path.join('.'))).toContain('owners')
  })
})
