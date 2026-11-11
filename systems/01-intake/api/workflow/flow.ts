import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'
import {
  AppealInputSchema,
  BeneficialOwnersInputSchema,
  BusinessProfileInputSchema,
  ConsentInputSchema,
  DocumentsInputSchema,
  EligibilityResultSchema,
  HardshipEvidenceInputSchema,
  type IntakeContext,
  IntakeContextSchema,
  type IntakeResult,
  PrefillResultSchema,
  ReviewDecidedEventSchema,
  ReviewInputSchema,
  RiskCompletedEventSchema,
  StandardFinancialsInputSchema,
} from '../../shared/index.js'
import { changeRequestTarget, INTAKE_EDIT_ORDER } from './invalidation.js'
import type { IntakeDeps } from './ports.js'
import { buildRiskInput, evaluateEligibility, initialBusinessProfile } from './routing.js'

export const intakeFlow = defineWizard(
  {
    name: 'conditional-grant-intake',
    version: 1,
    context: IntakeContextSchema,
    deps: boundary.trusted<IntakeDeps>(),
    events: {
      'risk.completed': RiskCompletedEventSchema,
      'review.decided': ReviewDecidedEventSchema,
    },
    unmatchedEvents: { buffer: false, ttl: '24h' },
    output: ({ context }) => {
      const decision = context.reviewerDecision?.decision
      if (decision === 'approve') return finalResult(context, 'approved')
      if (decision === 'reject') return finalResult(context, 'rejected')
      if (context.risk?.outcome === 'approved') return finalResult(context, 'approved')
      if (context.risk?.outcome === 'rejected') return finalResult(context, 'rejected')
      throw new Error('Final decision is missing')
    },
  },
  ({ step, view, steps }) =>
    steps(
      {
        consent: view({
          input: ConsentInputSchema,
          initial: {
            consentToPreviousApplication: false,
            consentToRegistry: false,
            contactEmail: '',
          },
          exit: ({ output, update }) => update({ consent: output }),
          next: 'prefill',
        }),
        prefill: step({
          run: ({ context, deps, idempotencyKey }) => {
            if (context.consent === undefined) throw new Error('Consent is missing')
            return deps.prefill(context.applicationId, context.consent, idempotencyKey)
          },
          output: PrefillResultSchema,
          idempotent: ({ context }) => `prefill:${context.applicationId}`,
          exit: ({ output, update }) => update({ prefill: output }),
          next: 'businessProfile',
          dependsOn: ['consent'],
        }),
        businessProfile: view({
          input: BusinessProfileInputSchema,
          initial: ({ context }) => initialBusinessProfile(context.prefill),
          exit: ({ output, update }) => update({ businessProfile: output }),
          next: ({ output }) =>
            output.legalStructure === 'incorporated' ? 'beneficialOwners' : 'eligibility',
          targets: ['beneficialOwners', 'eligibility'],
          dependsOn: ['prefill'],
        }),
        beneficialOwners: view({
          input: BeneficialOwnersInputSchema,
          initial: { owners: [] },
          exit: ({ output, update }) => update({ beneficialOwners: output }),
          next: 'eligibility',
          dependsOn: ['businessProfile'],
        }),
        eligibility: step({
          run: async ({ context }) => evaluateEligibility(context),
          output: EligibilityResultSchema,
          exit: ({ output, update }) => update({ eligibility: output }),
          next: 'eligibilityRoute',
          dependsOn: { any: ['businessProfile', 'beneficialOwners'] },
        }),
        eligibilityRoute: step({
          next: ({ context }) => {
            if (context.eligibility === undefined) throw new Error('Eligibility result is missing')
            if (context.eligibility.path === 'standard') return 'standardFinancials'
            if (context.eligibility.path === 'hardship') return 'hardshipEvidence'
            return 'appeal'
          },
          targets: ['standardFinancials', 'hardshipEvidence', 'appeal'],
          dependsOn: ['eligibility'],
        }),
        standardFinancials: view({
          input: StandardFinancialsInputSchema,
          exit: ({ output, update }) => update({ standardFinancials: output }),
          next: 'documents',
          dependsOn: ['eligibilityRoute'],
        }),
        hardshipEvidence: view({
          input: HardshipEvidenceInputSchema,
          exit: ({ output, update }) => update({ hardshipEvidence: output }),
          next: 'documents',
          dependsOn: ['eligibilityRoute'],
        }),
        appeal: view({
          input: AppealInputSchema,
          exit: ({ output, update }) => update({ appeal: output }),
          next: 'documents',
          dependsOn: ['eligibilityRoute'],
        }),
        documents: view({
          input: DocumentsInputSchema,
          initial: ({ context }) => context.documents ?? { documents: [] },
          exit: ({ output, update }) => update({ documents: output }),
          next: 'review',
          dependsOn: { any: ['standardFinancials', 'hardshipEvidence', 'appeal'] },
        }),
        review: view({
          input: ReviewInputSchema,
          initial: ({ context }) => context.review ?? {},
          exit: ({ output, update }) => update({ review: output }),
          next: 'queueRisk',
          dependsOn: ['documents'],
        }),
        queueRisk: step({
          run: ({ context, deps, idempotencyKey }) =>
            deps.enqueueRisk(context.applicationId, buildRiskInput(context), idempotencyKey),
          output: z.string().min(1),
          idempotent: ({ context }) =>
            `risk:${context.applicationId}:${context.changeRequestCount}`,
          exit: ({ output, update }) => update({ riskJobId: output }),
          next: 'awaitRisk',
          dependsOn: ['review'],
        }),
        awaitRisk: step({
          waitFor: {
            'risk.completed': ({ context, payload, update }) => {
              if (payload.jobId !== context.riskJobId) return { keep: true }
              update({ risk: payload })
            },
          },
          next: 'riskRoute',
          dependsOn: ['queueRisk'],
        }),
        riskRoute: step({
          next: ({ context }) => {
            if (context.risk === undefined) throw new Error('Risk result is missing')
            if (context.risk.outcome === 'approved') return 'approved'
            if (context.risk.outcome === 'rejected') return 'rejected'
            return 'manualReview'
          },
          targets: ['approved', 'rejected', 'manualReview'],
          dependsOn: ['awaitRisk'],
        }),
        manualReview: step({
          waitFor: {
            'review.decided': ({ context, payload, update }) => {
              update({
                reviewerDecision: payload,
                changeRequestCount:
                  payload.decision === 'request-changes'
                    ? context.changeRequestCount + 1
                    : context.changeRequestCount,
              })
            },
          },
          next: 'manualRoute',
          dependsOn: ['riskRoute'],
        }),
        manualRoute: step({
          next: ({ context }) => {
            const decision = context.reviewerDecision?.decision
            if (decision === 'approve') return 'approved'
            if (decision === 'reject') return 'rejected'
            if (decision === 'request-changes') {
              return changeRequestTarget(context.reviewerDecision?.requestedFields ?? [])
            }
            throw new Error('Reviewer decision is missing')
          },
          targets: ['approved', 'rejected', ...INTAKE_EDIT_ORDER],
          dependsOn: ['manualReview'],
        }),
        approved: step({
          run: ({ context }) => finalResult(context, 'approved'),
        }),
        rejected: step({
          run: ({ context }) => finalResult(context, 'rejected'),
        }),
      },
      { start: 'consent' },
    ),
)

export type IntakeFlow = typeof intakeFlow

function finalResult(context: IntakeContext, decision: IntakeResult['decision']): IntakeResult {
  const reviewed =
    (decision === 'approved' && context.reviewerDecision?.decision === 'approve') ||
    (decision === 'rejected' && context.reviewerDecision?.decision === 'reject')
  return {
    applicationId: context.applicationId,
    decision,
    source: reviewed ? 'reviewer' : 'automatic',
  }
}
