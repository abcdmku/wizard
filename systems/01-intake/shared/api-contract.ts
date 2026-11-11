import { z } from 'zod'
import {
  ApplicationIdSchema,
  ApplicationStatusSchema,
  CommandIdSchema,
  DurableVersionSchema,
  IntakeStepIdSchema,
  IntakeViewStepIdSchema,
  ReviewerDecisionSchema,
  RiskOutcomeSchema,
  TimestampSchema,
  ValidationIssueSchema,
} from './common.js'

const commandMeta = { commandId: CommandIdSchema, expectedVersion: DurableVersionSchema.optional() }
const basicCommand = <T extends 'start' | 'next' | 'back'>(type: T) =>
  z.object({ ...commandMeta, type: z.literal(type) }).strict()

export const ApplicationCommandSchema = z.discriminatedUnion('type', [
  basicCommand('start'),
  basicCommand('next'),
  basicCommand('back'),
  z.object({ ...commandMeta, type: z.literal('go'), step: IntakeViewStepIdSchema }).strict(),
  z
    .object({
      ...commandMeta,
      type: z.literal('setInput'),
      step: IntakeViewStepIdSchema,
      patch: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ ...commandMeta, type: z.literal('resetInput'), step: IntakeViewStepIdSchema })
    .strict(),
  z.object({ ...commandMeta, type: z.literal('cancel'), reason: z.string().optional() }).strict(),
])
export type ApplicationCommand = z.infer<typeof ApplicationCommandSchema>

export const ReviewerCommandSchema = z
  .object({
    commandId: CommandIdSchema,
    expectedVersion: DurableVersionSchema.optional(),
    type: ReviewerDecisionSchema,
    reason: z.string().trim().min(3).max(1_000),
    requestedFields: z.array(z.string().min(1)).max(20).default([]),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.type === 'request-changes' && value.requestedFields.length === 0) {
      issue.addIssue({
        code: 'custom',
        message: 'Choose at least one field to change',
        path: ['requestedFields'],
      })
    }
  })
export type ReviewerCommand = z.infer<typeof ReviewerCommandSchema>

export const CreateApplicationRequestSchema = z
  .object({ applicantName: z.string().trim().min(2).max(160) })
  .strict()
export type CreateApplicationRequest = z.infer<typeof CreateApplicationRequestSchema>

export const StepViewSchema = z
  .object({
    id: IntakeStepIdSchema,
    kind: z.enum(['step', 'view', 'child']),
    status: z.string(),
    phase: z.string().optional(),
    attempt: z.number().int().nonnegative(),
    input: z.unknown().optional(),
    issues: z.array(ValidationIssueSchema).optional(),
    error: z
      .object({ name: z.string(), message: z.string(), code: z.string().optional() })
      .optional(),
  })
  .strict()
export type StepView = z.infer<typeof StepViewSchema>

export const SafeContextSchema = z
  .object({
    applicantName: z.string(),
    legalName: z.string().optional(),
    legalStructure: z.string().optional(),
    requestedAmount: z.number().optional(),
    eligibilityPath: z.string().optional(),
    riskOutcome: RiskOutcomeSchema.optional(),
    changeRequestReason: z.string().optional(),
    documentCount: z.number().int().nonnegative(),
  })
  .strict()

export const ApplicationViewSchema = z
  .object({
    id: ApplicationIdSchema,
    applicantName: z.string(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    status: ApplicationStatusSchema,
    workflow: z
      .object({
        instanceId: z.string(),
        epoch: z.number().int().nonnegative(),
        seq: z.number().int().nonnegative(),
        status: z.string(),
        current: IntakeStepIdSchema.nullable(),
        context: SafeContextSchema,
        steps: z.record(IntakeStepIdSchema, StepViewSchema),
        output: z.unknown().optional(),
      })
      .strict(),
  })
  .strict()
export type ApplicationView = z.infer<typeof ApplicationViewSchema>

export const ReviewerQueueItemSchema = z
  .object({
    id: ApplicationIdSchema,
    applicantName: z.string(),
    status: ApplicationStatusSchema,
    requestedAmount: z.number().optional(),
    riskOutcome: RiskOutcomeSchema.optional(),
    updatedAt: TimestampSchema,
  })
  .strict()
export type ReviewerQueueItem = z.infer<typeof ReviewerQueueItemSchema>
export const ReviewerQueueSchema = z.object({ applications: z.array(ReviewerQueueItemSchema) })

export const CommandResponseSchema = z
  .object({
    ok: z.boolean(),
    code: z.string(),
    replayed: z.boolean().default(false),
    version: DurableVersionSchema.optional(),
    issues: z.array(ValidationIssueSchema).optional(),
    application: ApplicationViewSchema.optional(),
  })
  .strict()
export type CommandResponse = z.infer<typeof CommandResponseSchema>

export const DemoActionResponseSchema = z
  .object({
    ok: z.literal(true),
    action: z.enum(['seeded', 'reset']),
    applicationIds: z.array(ApplicationIdSchema),
  })
  .strict()
export type DemoActionResponse = z.infer<typeof DemoActionResponseSchema>

export const HealthResponseSchema = z
  .object({ ok: z.literal(true), service: z.literal('intake-api'), database: z.literal('ready') })
  .strict()
export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const ApiErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
    issues: z.array(ValidationIssueSchema).optional(),
  })
  .strict()
export type ApiError = z.infer<typeof ApiErrorSchema>
