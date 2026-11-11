import type { IntakeStepId, IntakeViewStepId } from '../../shared/index.js'

export const INTAKE_EDIT_ORDER = [
  'consent',
  'businessProfile',
  'beneficialOwners',
  'standardFinancials',
  'hardshipEvidence',
  'appeal',
  'documents',
  'review',
] as const satisfies readonly IntakeViewStepId[]

/** First completed step to invalidate after a persisted draft changes. */
export function invalidationRootFor(step: IntakeViewStepId): IntakeStepId | undefined {
  switch (step) {
    case 'consent':
      return 'prefill'
    case 'businessProfile':
    case 'beneficialOwners':
      return 'eligibility'
    case 'standardFinancials':
    case 'hardshipEvidence':
    case 'appeal':
      return 'documents'
    case 'documents':
      return 'review'
    case 'review':
      return 'queueRisk'
  }
}

/** Earliest view named by a reviewer's field paths. */
export function changeRequestTarget(fields: readonly string[]): IntakeViewStepId {
  for (const step of INTAKE_EDIT_ORDER) {
    if (fields.some((field) => field === step || field.startsWith(`${step}.`))) return step
  }
  return 'documents'
}
