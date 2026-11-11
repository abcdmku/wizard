import { describe, expect, it } from 'vitest'
import { normalizeBranchStatus, operatorCurrentStepLabel } from '../apps/web/src/contracts'

describe('operator branch status normalization', () => {
  it('renders an authorized payment branch as complete', () => {
    expect(normalizeBranchStatus('authorized')).toBe('succeeded')
  })

  it('names the durable fraud wait when no runtime step is current', () => {
    expect(operatorCurrentStepLabel('fraud_review', null)).toBe('Fraud review')
    expect(operatorCurrentStepLabel('processing', 'readinessJoin')).toBe('readinessJoin')
  })
})
