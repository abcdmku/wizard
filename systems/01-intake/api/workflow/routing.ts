import type {
  ApplicationStatus,
  BusinessProfileInput,
  EligibilityResult,
  IntakeContext,
  PrefillResult,
  RiskInput,
} from '../../shared/index.js'

export function initialBusinessProfile(prefill: PrefillResult | undefined) {
  if (prefill === undefined) return {}
  const previous = prefill.previousApplication
  const registry = prefill.registryProfile
  return {
    legalName: registry.legalName,
    legalStructure: registry.legalStructure,
    postalCode: registry.postalCode,
    ...(registry.registrationNumber === undefined
      ? {}
      : { registrationNumber: registry.registrationNumber }),
    ...(previous === undefined ? {} : { requestedAmount: previous.requestedAmount }),
  } satisfies Partial<BusinessProfileInput>
}

export function evaluateEligibility(context: IntakeContext): EligibilityResult {
  const profile = requireBusinessProfile(context)
  if (profile.tradingMonths < 6 || profile.requestedAmount > profile.annualRevenue) {
    return {
      path: 'appeal',
      reasons: ['The request needs an eligibility appeal before financial review.'],
      checkedAt: context.prefill?.fetchedAt ?? new Date(0).toISOString(),
    }
  }
  if (profile.experiencedHardship || (profile.revenueDropPercent ?? 0) >= 20) {
    return {
      path: 'hardship',
      reasons: ['The reported hardship requires evidence and a recovery plan.'],
      checkedAt: context.prefill?.fetchedAt ?? new Date(0).toISOString(),
    }
  }
  return {
    path: 'standard',
    reasons: ['The application qualifies for the standard financial route.'],
    checkedAt: context.prefill?.fetchedAt ?? new Date(0).toISOString(),
  }
}

export function buildRiskInput(context: IntakeContext): RiskInput {
  const profile = requireBusinessProfile(context)
  if (context.eligibility === undefined) throw new Error('Eligibility result is missing')
  if (context.documents === undefined) throw new Error('Document metadata is missing')
  return {
    requestedAmount: profile.requestedAmount,
    annualRevenue: profile.annualRevenue,
    tradingMonths: profile.tradingMonths,
    employeeCount: profile.employeeCount,
    revenueDropPercent: profile.revenueDropPercent ?? 0,
    eligibilityPath: context.eligibility.path,
    documentCount: context.documents.documents.length,
  }
}

export function requireBusinessProfile(context: IntakeContext): BusinessProfileInput {
  if (context.businessProfile === undefined) throw new Error('Business profile is missing')
  return context.businessProfile
}

export function statusForCurrentStep(current: string | null): ApplicationStatus {
  switch (current) {
    case 'prefill':
      return 'prefilling'
    case 'eligibility':
    case 'eligibilityRoute':
      return 'eligibility-pending'
    case 'standardFinancials':
      return 'standard-financials'
    case 'hardshipEvidence':
      return 'hardship-evidence'
    case 'appeal':
      return 'appeal'
    case 'documents':
      return 'documents'
    case 'review':
      return 'review'
    case 'queueRisk':
    case 'awaitRisk':
    case 'riskRoute':
      return 'risk-review'
    case 'manualReview':
    case 'manualRoute':
      return 'awaiting-reviewer'
    default:
      return 'draft'
  }
}
