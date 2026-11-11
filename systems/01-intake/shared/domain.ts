import { z } from 'zod'
import {
  ApplicantIdSchema,
  ApplicationIdSchema,
  EligibilityPathSchema,
  ReviewerDecisionSchema,
  RiskOutcomeSchema,
  TenantIdSchema,
  TimestampSchema,
} from './common.js'
import { DocumentsInputSchema, LegalStructureSchema, ReviewInputSchema } from './forms.js'

export const PreviousApplicationSchema = z
  .object({ legalName: z.string(), requestedAmount: z.number(), submittedAt: TimestampSchema })
  .strict()

export const RegistryProfileSchema = z
  .object({
    legalName: z.string(),
    registrationNumber: z.string().optional(),
    legalStructure: LegalStructureSchema,
    postalCode: z.string(),
    verified: z.boolean(),
  })
  .strict()

export const PrefillResultSchema = z
  .object({
    previousApplication: PreviousApplicationSchema.optional(),
    registryProfile: RegistryProfileSchema,
    fetchedAt: TimestampSchema,
  })
  .strict()
export type PrefillResult = z.infer<typeof PrefillResultSchema>

export const EligibilityResultSchema = z
  .object({ path: EligibilityPathSchema, reasons: z.array(z.string()), checkedAt: TimestampSchema })
  .strict()
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>

export const RiskInputSchema = z
  .object({
    requestedAmount: z.number().positive(),
    annualRevenue: z.number().nonnegative(),
    tradingMonths: z.number().int().nonnegative(),
    employeeCount: z.number().int().nonnegative(),
    revenueDropPercent: z.number().min(0).max(100),
    eligibilityPath: EligibilityPathSchema,
    documentCount: z.number().int().nonnegative(),
  })
  .strict()
export type RiskInput = z.infer<typeof RiskInputSchema>

export const RiskCompletedEventSchema = z
  .object({
    jobId: z.string().min(1),
    outcome: RiskOutcomeSchema,
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.string()),
    completedAt: TimestampSchema,
  })
  .strict()
export type RiskCompletedEvent = z.infer<typeof RiskCompletedEventSchema>

export const ReviewDecidedEventSchema = z
  .object({
    decision: ReviewerDecisionSchema,
    reviewerId: z.string().min(1),
    reason: z.string().trim().min(3).max(1_000),
    requestedFields: z.array(z.string().min(1)).max(20).default([]),
    decidedAt: TimestampSchema,
  })
  .strict()
export type ReviewDecidedEvent = z.infer<typeof ReviewDecidedEventSchema>

export const IntakeResultSchema = z
  .object({
    applicationId: ApplicationIdSchema,
    decision: z.enum(['approved', 'rejected']),
    source: z.enum(['automatic', 'reviewer']),
  })
  .strict()
export type IntakeResult = z.infer<typeof IntakeResultSchema>

export const IntakeContextSchema = z
  .object({
    applicationId: ApplicationIdSchema,
    tenantId: TenantIdSchema,
    applicantId: ApplicantIdSchema,
    applicantName: z.string().min(1),
    // Draft seeds. A view's `initial` reads only the context, so these three stay here.
    // Every other hand-off between steps goes through `needs`.
    prefill: PrefillResultSchema.optional(),
    documents: DocumentsInputSchema.optional(),
    review: ReviewInputSchema.optional(),
    // Written by the sink that finishes the run. The wizard's `output` selector reads only the
    // context, and the selector keeps the result typed across both branches.
    result: IntakeResultSchema.optional(),
    // How many times a reviewer asked for changes. Each one starts a new risk job.
    changeRequestCount: z.number().int().nonnegative().default(0),
  })
  .strict()
export type IntakeContext = z.infer<typeof IntakeContextSchema>
