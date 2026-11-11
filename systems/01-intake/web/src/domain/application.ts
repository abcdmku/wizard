import type { ZodType } from 'zod'

import {
  type ApplicationCommand,
  type ApplicationView,
  BusinessProfileInputSchema,
  type DurableVersion,
  type IntakeStepId,
  type IntakeViewStepId,
  type ReviewerCommand,
  type StepView,
} from '../../../shared'
import { type ApplicantStep, stepFromStatus } from './steps'

export function commandId(): string {
  return globalThis.crypto.randomUUID()
}

export function versionOf(application: ApplicationView): DurableVersion {
  return {
    epoch: application.workflow.epoch,
    seq: application.workflow.seq,
  }
}

export function startCommand(application?: ApplicationView): ApplicationCommand {
  return {
    commandId: commandId(),
    type: 'start',
    ...(application ? { expectedVersion: versionOf(application) } : {}),
  }
}

export function navigationCommand(
  application: ApplicationView,
  type: 'back' | 'next',
): ApplicationCommand {
  return { commandId: commandId(), expectedVersion: versionOf(application), type }
}

export function goCommand(
  application: ApplicationView,
  step: IntakeViewStepId,
): ApplicationCommand {
  return { commandId: commandId(), expectedVersion: versionOf(application), step, type: 'go' }
}

export function inputCommand(
  application: ApplicationView,
  step: IntakeViewStepId,
  patch: Readonly<Record<string, unknown>>,
): ApplicationCommand {
  return {
    commandId: commandId(),
    expectedVersion: versionOf(application),
    patch: { ...patch },
    step,
    type: 'setInput',
  }
}

export function reviewerCommand(
  application: ApplicationView,
  type: ReviewerCommand['type'],
  reason: string,
  requestedFields: string[] = [],
): ReviewerCommand {
  return {
    commandId: commandId(),
    expectedVersion: versionOf(application),
    reason,
    requestedFields,
    type,
  }
}

export function stepView(application: ApplicationView, step: IntakeStepId): StepView | undefined {
  return application.workflow.steps[step]
}

export function parsedStepInput<T>(
  application: ApplicationView,
  step: IntakeViewStepId,
  schema: ZodType<T>,
): T | undefined {
  const input = stepView(application, step)?.input
  const result = schema.safeParse(input)
  return result.success ? result.data : undefined
}

export function isIncorporated(application: ApplicationView): boolean {
  const business = parsedStepInput(application, 'businessProfile', BusinessProfileInputSchema)
  return business?.legalStructure === 'incorporated'
}

export function currentApplicantStep(application: ApplicationView): ApplicantStep {
  switch (application.workflow.current) {
    case 'consent':
      return 'consent'
    case 'prefill':
    case 'businessProfile':
      return 'business'
    case 'beneficialOwners':
      return 'owners'
    case 'eligibility':
    case 'eligibilityRoute':
    case 'standardFinancials':
    case 'hardshipEvidence':
    case 'appeal':
      return 'eligibility'
    case 'documents':
      return 'documents'
    case 'review':
      return 'review'
    case 'queueRisk':
    case 'awaitRisk':
    case 'riskRoute':
    case 'manualReview':
    case 'manualRoute':
      return 'risk'
    case 'approved':
    case 'rejected':
      return 'result'
    case null:
      return stepFromStatus(application.status)
  }
}

export function currency(value: number | undefined): string {
  if (value === undefined) return 'Not provided'
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}

export function shortDate(value: string | undefined): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Not available'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}
