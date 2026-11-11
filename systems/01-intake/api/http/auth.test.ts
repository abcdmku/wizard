import { describe, expect, it } from 'vitest'
import {
  DEMO_WEST_APPLICANT_ID,
  DEMO_WEST_APPLICANT_TOKEN,
  DEMO_WEST_TENANT_ID,
  requireDemoScope,
} from './auth.js'
import { IntakeHttpError } from './errors.js'

describe('demo authentication', () => {
  it('creates a distinct authenticated west-tenant principal', () => {
    expect(
      requireDemoScope(
        {
          authorization: `Bearer ${DEMO_WEST_APPLICANT_TOKEN}`,
          'x-tenant-id': DEMO_WEST_TENANT_ID,
        },
        'applicant',
      ),
    ).toEqual({
      role: 'applicant',
      tenantId: DEMO_WEST_TENANT_ID,
      applicantId: DEMO_WEST_APPLICANT_ID,
    })
  })

  it('rejects using a valid principal with another tenant header', () => {
    expect(() =>
      requireDemoScope(
        {
          authorization: `Bearer ${DEMO_WEST_APPLICANT_TOKEN}`,
          'x-tenant-id': 'demo-grants',
        },
        'applicant',
      ),
    ).toThrow(IntakeHttpError)
  })
})
