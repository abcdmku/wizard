import type { ApplicationStatus, IntakeStepId } from '../../../shared/common'

export const applicantStepOrder = [
  'consent',
  'business',
  'owners',
  'eligibility',
  'documents',
  'review',
  'risk',
  'result',
] as const

export type ApplicantStep = (typeof applicantStepOrder)[number]

export function isApplicantStep(value: string): value is ApplicantStep {
  return applicantStepOrder.some((step) => step === value)
}

export const stepLabels: Record<ApplicantStep, string> = {
  consent: 'Consent',
  business: 'Business',
  owners: 'Owners',
  eligibility: 'Eligibility',
  documents: 'Documents',
  review: 'Review',
  risk: 'Risk check',
  result: 'Decision',
}

export function applicantPath(applicationId: string, step: ApplicantStep): string {
  return `/apply/${encodeURIComponent(applicationId)}/${step}`
}

export function serverStepFor(step: ApplicantStep): IntakeStepId {
  switch (step) {
    case 'consent':
      return 'consent'
    case 'business':
      return 'businessProfile'
    case 'owners':
      return 'beneficialOwners'
    case 'eligibility':
      return 'eligibility'
    case 'documents':
      return 'documents'
    case 'review':
      return 'review'
    case 'risk':
      return 'awaitRisk'
    case 'result':
      return 'riskRoute'
  }
}

export function stepFromStatus(status: ApplicationStatus): ApplicantStep {
  switch (status) {
    case 'draft':
      return 'consent'
    case 'prefilling':
      return 'business'
    case 'eligibility-pending':
    case 'standard-financials':
    case 'hardship-evidence':
    case 'appeal':
      return 'eligibility'
    case 'documents':
      return 'documents'
    case 'review':
    case 'changes-requested':
      return 'review'
    case 'risk-review':
    case 'awaiting-reviewer':
      return 'risk'
    case 'approved':
    case 'rejected':
    case 'cancelled':
    case 'failed':
      return 'result'
  }
}

export function progressSteps(includeOwners: boolean) {
  return applicantStepOrder
    .filter((step) => includeOwners || step !== 'owners')
    .filter((step) => step !== 'risk' && step !== 'result')
    .map((id) => ({ id, label: stepLabels[id] }))
}
