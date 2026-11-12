import type {
  ApplicationStatus,
  BusinessProfileInput,
  DocumentsInput,
  EligibilityResult,
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

/** Chooses the evidence path from the submitted business profile. */
export function evaluateEligibility(
  profile: BusinessProfileInput,
  checkedAt: string,
): EligibilityResult {
  if (profile.tradingMonths < 6 || profile.requestedAmount > profile.annualRevenue) {
    return {
      path: 'appeal',
      reasons: ['The request needs an eligibility appeal before financial review.'],
      checkedAt,
    }
  }
  if (profile.experiencedHardship || (profile.revenueDropPercent ?? 0) >= 20) {
    return {
      path: 'hardship',
      reasons: ['The reported hardship requires evidence and a recovery plan.'],
      checkedAt,
    }
  }
  return {
    path: 'standard',
    reasons: ['The application qualifies for the standard financial route.'],
    checkedAt,
  }
}

/** The step outputs the risk assessment is built from. */
export interface RiskInputSources {
  readonly businessProfile: BusinessProfileInput
  readonly eligibility: EligibilityResult
  readonly documents: DocumentsInput
}

export function buildRiskInput(sources: RiskInputSources): RiskInput {
  const profile = sources.businessProfile
  return {
    requestedAmount: profile.requestedAmount,
    annualRevenue: profile.annualRevenue,
    tradingMonths: profile.tradingMonths,
    employeeCount: profile.employeeCount,
    revenueDropPercent: profile.revenueDropPercent ?? 0,
    eligibilityPath: sources.eligibility.path,
    documentCount: sources.documents.documents.length,
  }
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
