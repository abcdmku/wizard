import {
  boundary,
  defineProjection,
  type ProjectionOutput,
  type StepId,
  type StepState,
} from '@openwizard/core'
import type { ApplicantViewer, ReviewerViewer } from '../../shared/index.js'
import { type IntakeFlow, intakeFlow } from './flow.js'
import { applicationStatus, type IntakeState } from './status.js'

function safeStep<K extends StepId<IntakeFlow>>(step: StepState<IntakeFlow, K>, input?: unknown) {
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
  const profile = state.context.businessProfile
  const decision = state.context.reviewerDecision
  return {
    applicantName: state.context.applicantName,
    ...(profile?.legalName === undefined ? {} : { legalName: profile.legalName }),
    ...(profile?.legalStructure === undefined ? {} : { legalStructure: profile.legalStructure }),
    ...(profile?.requestedAmount === undefined ? {} : { requestedAmount: profile.requestedAmount }),
    ...(state.context.eligibility?.path === undefined
      ? {}
      : { eligibilityPath: state.context.eligibility.path }),
    ...(state.context.risk?.outcome === undefined
      ? {}
      : { riskOutcome: state.context.risk.outcome }),
    ...(decision?.decision === 'request-changes' ? { changeRequestReason: decision.reason } : {}),
    documentCount: state.context.documents?.documents.length ?? 0,
  }
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

export const applicantProjection = defineProjection(intakeFlow, {
  scope: boundary.trusted<ApplicantViewer>(),
  select: ({ state, scope }) => {
    if (
      scope.tenantId !== state.context.tenantId ||
      scope.applicantId !== state.context.applicantId
    ) {
      return { access: 'forbidden' as const }
    }
    const decision = state.context.reviewerDecision
    return {
      access: 'granted' as const,
      role: 'applicant' as const,
      applicationId: state.context.applicationId,
      applicantName: state.context.applicantName,
      status: applicationStatus(state),
      workflow: workflowSummary(state, 'applicant'),
      forms: {
        consent: state.context.consent,
        businessProfile: state.context.businessProfile,
        beneficialOwners: state.context.beneficialOwners,
        eligibilityPath: state.context.eligibility?.path,
        standardFinancials: state.context.standardFinancials,
        hardshipEvidence: state.context.hardshipEvidence,
        appeal: state.context.appeal,
        documents: state.context.documents,
        review: state.context.review,
      },
      ...(decision?.decision === 'request-changes'
        ? {
            changeRequest: {
              reason: decision.reason,
              requestedFields: decision.requestedFields,
              decidedAt: decision.decidedAt,
            },
          }
        : {}),
    }
  },
})

export const reviewerProjection = defineProjection(intakeFlow, {
  scope: boundary.trusted<ReviewerViewer>(),
  select: ({ state, scope }) => {
    if (scope.tenantId !== state.context.tenantId) {
      return { access: 'forbidden' as const }
    }
    const reviewerDecision = state.context.reviewerDecision
    return {
      access: 'granted' as const,
      role: 'reviewer' as const,
      applicationId: state.context.applicationId,
      applicantId: state.context.applicantId,
      applicantName: state.context.applicantName,
      status: applicationStatus(state),
      workflow: workflowSummary(state, 'reviewer'),
      riskJobId: state.context.riskJobId,
      risk: state.context.risk,
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
