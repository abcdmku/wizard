import {
  boundary,
  defineProjection,
  type ProjectionOutput,
  type StepId,
  type StepState,
} from '@openwizard/core'
import type { ApplicantViewer, ReviewerViewer } from '../../shared/index.js'
import { applicationStatus, type IntakeState } from './status.js'
import { type IntakeWizard, intakeWizard } from './wizard.js'

function safeStep<K extends StepId<IntakeWizard>>(
  step: StepState<IntakeWizard, K>,
  input?: unknown,
) {
  const issues = step.issues?.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((part) => {
      const key = typeof part === 'object' ? part.key : part
      return typeof key === 'symbol' ? (key.description ?? key.toString()) : key
    }),
  }))
  return {
    id: step.id,
    kind: step.kind,
    status: step.status,
    attempt: step.attempt,
    ...(input === undefined ? {} : { input }),
    ...(issues === undefined ? {} : { issues }),
  }
}

function reviewerOwners(state: IntakeState) {
  const input = state.steps.beneficialOwners.input
  if (input?.owners === undefined) return undefined
  return {
    owners: input.owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      ownershipPercent: owner.ownershipPercent,
    })),
  }
}

function projectedSteps(state: IntakeState, audience: 'applicant' | 'reviewer') {
  const applicant = audience === 'applicant'
  return {
    consent: safeStep(state.steps.consent, applicant ? state.steps.consent.input : undefined),
    prefill: safeStep(state.steps.prefill),
    businessProfile: safeStep(state.steps.businessProfile, state.steps.businessProfile.input),
    beneficialOwners: safeStep(
      state.steps.beneficialOwners,
      applicant ? state.steps.beneficialOwners.input : reviewerOwners(state),
    ),
    eligibility: safeStep(state.steps.eligibility),
    eligibilityRoute: safeStep(state.steps.eligibilityRoute),
    standardFinancials: safeStep(
      state.steps.standardFinancials,
      state.steps.standardFinancials.input,
    ),
    hardshipEvidence: safeStep(state.steps.hardshipEvidence, state.steps.hardshipEvidence.input),
    appeal: safeStep(state.steps.appeal, state.steps.appeal.input),
    documents: safeStep(state.steps.documents, state.steps.documents.input),
    review: safeStep(state.steps.review, state.steps.review.input),
    queueRisk: safeStep(state.steps.queueRisk),
    awaitRisk: safeStep(state.steps.awaitRisk),
    riskRoute: safeStep(state.steps.riskRoute),
    manualReview: safeStep(state.steps.manualReview),
    manualRoute: safeStep(state.steps.manualRoute),
    approved: safeStep(state.steps.approved),
    rejected: safeStep(state.steps.rejected),
  }
}

function safeContext(state: IntakeState) {
  const profile = submittedProfile(state)
  const changeRequest = state.context.changeRequest
  return {
    applicantName: state.context.applicantName,
    ...(profile?.legalName === undefined ? {} : { legalName: profile.legalName }),
    ...(profile?.legalStructure === undefined ? {} : { legalStructure: profile.legalStructure }),
    ...(profile?.requestedAmount === undefined ? {} : { requestedAmount: profile.requestedAmount }),
    ...(state.steps.eligibility.output?.path === undefined
      ? {}
      : { eligibilityPath: state.steps.eligibility.output.path }),
    ...(state.steps.awaitRisk.output?.outcome === undefined
      ? {}
      : { riskOutcome: state.steps.awaitRisk.output.outcome }),
    ...(changeRequest === undefined ? {} : { changeRequestReason: changeRequest.reason }),
    documentCount: state.context.documents?.documents.length ?? 0,
  }
}

/**
 * The business profile as last submitted. A reopened profile has no output until it is
 * submitted again, so its saved draft stands in: it starts as the last submission.
 */
function submittedProfile(state: IntakeState) {
  const step = state.steps.businessProfile
  return step.output ?? (step.visitedCount > 1 ? step.input : undefined)
}

function workflowSummary(state: IntakeState, audience: 'applicant' | 'reviewer') {
  return {
    instanceId: state.instanceId,
    epoch: state.epoch,
    seq: state.seq,
    status: state.status,
    current: state.current,
    context: safeContext(state),
    steps: projectedSteps(state, audience),
    ...(state.output === undefined ? {} : { output: state.output }),
  }
}

export const applicantProjection = defineProjection(intakeWizard, {
  scope: boundary.trusted<ApplicantViewer>(),
  select: ({ state, scope }) => {
    if (
      scope.tenantId !== state.context.tenantId ||
      scope.applicantId !== state.context.applicantId
    ) {
      return { access: 'forbidden' as const }
    }
    const changeRequest = state.context.changeRequest
    return {
      access: 'granted' as const,
      role: 'applicant' as const,
      applicationId: state.context.applicationId,
      applicantName: state.context.applicantName,
      status: applicationStatus(state),
      workflow: workflowSummary(state, 'applicant'),
      forms: {
        consent: state.steps.consent.output,
        businessProfile: state.steps.businessProfile.output,
        beneficialOwners: state.steps.beneficialOwners.output,
        eligibilityPath: state.steps.eligibility.output?.path,
        standardFinancials: state.steps.standardFinancials.output,
        hardshipEvidence: state.steps.hardshipEvidence.output,
        appeal: state.steps.appeal.output,
        documents: state.context.documents,
        review: state.context.review,
      },
      ...(changeRequest === undefined ? {} : { changeRequest }),
    }
  },
})

export const reviewerProjection = defineProjection(intakeWizard, {
  scope: boundary.trusted<ReviewerViewer>(),
  select: ({ state, scope }) => {
    if (scope.tenantId !== state.context.tenantId) {
      return { access: 'forbidden' as const }
    }
    // Editing a draft invalidates the review step, so an open change request stands in.
    const changeRequest = state.context.changeRequest
    const reviewerDecision =
      state.steps.manualReview.output ??
      (changeRequest === undefined
        ? undefined
        : { decision: 'request-changes' as const, ...changeRequest })
    return {
      access: 'granted' as const,
      role: 'reviewer' as const,
      applicationId: state.context.applicationId,
      applicantId: state.context.applicantId,
      applicantName: state.context.applicantName,
      status: applicationStatus(state),
      workflow: workflowSummary(state, 'reviewer'),
      riskJobId: state.steps.queueRisk.output,
      risk: state.steps.awaitRisk.output,
      reviewerDecision:
        reviewerDecision === undefined
          ? undefined
          : {
              decision: reviewerDecision.decision,
              reason: reviewerDecision.reason,
              requestedFields: reviewerDecision.requestedFields,
              decidedAt: reviewerDecision.decidedAt,
            },
      changeRequestCount: state.context.changeRequestCount,
    }
  },
})

export type ApplicantProjection = ProjectionOutput<typeof applicantProjection>
export type ReviewerProjection = ProjectionOutput<typeof reviewerProjection>
