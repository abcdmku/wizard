import { z } from 'zod'
import { TimestampSchema } from './common.js'

export const ConsentInputSchema = z
  .object({
    consentToPreviousApplication: z.boolean(),
    consentToRegistry: z.boolean(),
    contactEmail: z.email('Enter a valid email address'),
  })
  .strict()
  .refine((value) => value.consentToRegistry, {
    message: 'Registry consent is required to continue',
    path: ['consentToRegistry'],
  })
export type ConsentInput = z.infer<typeof ConsentInputSchema>

export const LegalStructureSchema = z.enum([
  'sole-proprietor',
  'partnership',
  'incorporated',
  'nonprofit',
])
export type LegalStructure = z.infer<typeof LegalStructureSchema>

export const BusinessProfileInputSchema = z
  .object({
    legalName: z.string().trim().min(2).max(160),
    registrationNumber: z.string().trim().min(3).max(64).optional(),
    legalStructure: LegalStructureSchema,
    annualRevenue: z.number().nonnegative().max(100_000_000),
    requestedAmount: z.number().positive().max(2_000_000),
    tradingMonths: z.number().int().nonnegative().max(1_200),
    employeeCount: z.number().int().nonnegative().max(10_000),
    postalCode: z.string().trim().min(3).max(16),
    experiencedHardship: z.boolean(),
    revenueDropPercent: z.number().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.legalStructure === 'incorporated' && value.registrationNumber === undefined) {
      issue.addIssue({
        code: 'custom',
        message: 'Registration number is required for incorporated applicants',
        path: ['registrationNumber'],
      })
    }
    if (value.experiencedHardship && value.revenueDropPercent === undefined) {
      issue.addIssue({
        code: 'custom',
        message: 'Enter the revenue drop caused by the hardship',
        path: ['revenueDropPercent'],
      })
    }
  })
export type BusinessProfileInput = z.infer<typeof BusinessProfileInputSchema>

export const BeneficialOwnerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(2).max(160),
    ownershipPercent: z.number().positive().max(100),
    dateOfBirth: z.iso.date().optional(),
  })
  .strict()
export type BeneficialOwner = z.infer<typeof BeneficialOwnerSchema>

export const BeneficialOwnersInputSchema = z
  .object({ owners: z.array(BeneficialOwnerSchema).min(1).max(12) })
  .strict()
  .superRefine((value, issue) => {
    const total = value.owners.reduce((sum, owner) => sum + owner.ownershipPercent, 0)
    if (Math.abs(total - 100) > 0.001) {
      issue.addIssue({
        code: 'custom',
        message: 'Ownership percentages must total 100%',
        path: ['owners'],
      })
    }
  })
export type BeneficialOwnersInput = z.infer<typeof BeneficialOwnersInputSchema>

export const StandardFinancialsInputSchema = z
  .object({
    annualExpenses: z.number().nonnegative().max(100_000_000),
    cashOnHand: z.number().nonnegative().max(100_000_000),
    fiscalYearEnd: z.iso.date(),
  })
  .strict()
export type StandardFinancialsInput = z.infer<typeof StandardFinancialsInputSchema>

export const HardshipEvidenceInputSchema = z
  .object({
    impactSummary: z.string().trim().min(30).max(2_000),
    recoveryPlan: z.string().trim().min(30).max(2_000),
    evidenceReference: z.string().trim().min(3).max(200),
  })
  .strict()
export type HardshipEvidenceInput = z.infer<typeof HardshipEvidenceInputSchema>

export const AppealInputSchema = z
  .object({
    appealReason: z.string().trim().min(30).max(2_000),
    supportingFacts: z.string().trim().min(30).max(2_000),
  })
  .strict()
export type AppealInput = z.infer<typeof AppealInputSchema>

export const DocumentMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    category: z.enum(['financial', 'hardship', 'identity', 'ownership', 'other']),
    sizeBytes: z.number().int().positive().max(20_000_000),
    uploadedAt: TimestampSchema,
  })
  .strict()
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>

export const DocumentsInputSchema = z
  .object({ documents: z.array(DocumentMetadataSchema).min(1).max(20) })
  .strict()
export type DocumentsInput = z.infer<typeof DocumentsInputSchema>

export const ReviewInputSchema = z
  .object({ confirmed: z.literal(true), signatureName: z.string().trim().min(2).max(160) })
  .strict()
export type ReviewInput = z.infer<typeof ReviewInputSchema>

export const IntakeFormSchemas = {
  consent: ConsentInputSchema,
  businessProfile: BusinessProfileInputSchema,
  beneficialOwners: BeneficialOwnersInputSchema,
  standardFinancials: StandardFinancialsInputSchema,
  hardshipEvidence: HardshipEvidenceInputSchema,
  appeal: AppealInputSchema,
  documents: DocumentsInputSchema,
  review: ReviewInputSchema,
} as const
