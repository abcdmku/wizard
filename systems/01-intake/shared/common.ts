import { z } from 'zod'

const identifier = (label: string) => z.string().trim().min(1, `${label} is required`).max(160)

export const TenantIdSchema = identifier('tenantId')
export const ApplicationIdSchema = identifier('applicationId')
export const ApplicantIdSchema = identifier('applicantId')
export const ReviewerIdSchema = identifier('reviewerId')
export const CommandIdSchema = identifier('commandId')
export const EventIdSchema = identifier('eventId')
export const TimestampSchema = z.iso.datetime({ offset: true })

export const DurableVersionSchema = z
  .object({ epoch: z.number().int().nonnegative(), seq: z.number().int().nonnegative() })
  .strict()
export type DurableVersion = z.infer<typeof DurableVersionSchema>

export const ApplicantViewerSchema = z
  .object({
    role: z.literal('applicant'),
    tenantId: TenantIdSchema,
    applicantId: ApplicantIdSchema,
  })
  .strict()
export type ApplicantViewer = z.infer<typeof ApplicantViewerSchema>

export const ReviewerViewerSchema = z
  .object({
    role: z.literal('reviewer'),
    tenantId: TenantIdSchema,
    reviewerId: ReviewerIdSchema,
  })
  .strict()
export type ReviewerViewer = z.infer<typeof ReviewerViewerSchema>

export const ViewerScopeSchema = z.discriminatedUnion('role', [
  ApplicantViewerSchema,
  ReviewerViewerSchema,
])
export type ViewerScope = z.infer<typeof ViewerScopeSchema>
export type Viewer = ViewerScope

export const IntakeStepIdSchema = z.enum([
  'consent',
  'prefill',
  'businessProfile',
  'beneficialOwners',
  'eligibility',
  'eligibilityRoute',
  'standardFinancials',
  'hardshipEvidence',
  'appeal',
  'documents',
  'review',
  'queueRisk',
  'awaitRisk',
  'riskRoute',
  'manualReview',
  'manualRoute',
  'approved',
  'rejected',
])
export type IntakeStepId = z.infer<typeof IntakeStepIdSchema>

export const IntakeViewStepIdSchema = z.enum([
  'consent',
  'businessProfile',
  'beneficialOwners',
  'standardFinancials',
  'hardshipEvidence',
  'appeal',
  'documents',
  'review',
])
export type IntakeViewStepId = z.infer<typeof IntakeViewStepIdSchema>

export const ApplicationStatusSchema = z.enum([
  'draft',
  'prefilling',
  'eligibility-pending',
  'standard-financials',
  'hardship-evidence',
  'appeal',
  'documents',
  'review',
  'risk-review',
  'awaiting-reviewer',
  'approved',
  'rejected',
  'changes-requested',
  'cancelled',
  'failed',
])
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>

export const EligibilityPathSchema = z.enum(['standard', 'hardship', 'appeal'])
export type EligibilityPath = z.infer<typeof EligibilityPathSchema>
export const RiskOutcomeSchema = z.enum(['approved', 'rejected', 'manual-review'])
export type RiskOutcome = z.infer<typeof RiskOutcomeSchema>
export const ReviewerDecisionSchema = z.enum(['approve', 'reject', 'request-changes'])
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>

export const ValidationIssueSchema = z
  .object({
    message: z.string().min(1),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    code: z.string().min(1).optional(),
  })
  .strict()
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>
