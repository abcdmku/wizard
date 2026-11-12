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
  type ReviewDecidedEvent,
  ReviewDecidedEventSchema,
  ReviewInputSchema,
  RiskCompletedEventSchema,
  StandardFinancialsInputSchema,
} from '../../shared/index.js'
import { changeRequestTarget, INTAKE_EDIT_ORDER } from './invalidation.js'
import type { IntakeDeps } from './ports.js'
import { buildRiskInput, evaluateEligibility, initialBusinessProfile } from './routing.js'

export const intakeWizard = defineWizard(
  {
    name: 'conditional-grant-intake',
    version: 2,
    description:
      'Collects a grant application, routes it by eligibility, scores its risk, and sends ' +
      'borderline cases to a reviewer who can approve, reject or ask for changes.',
    context: IntakeContextSchema,
    deps: boundary.trusted<IntakeDeps>(),
    events: {
      'risk.completed': RiskCompletedEventSchema,
      'review.decided': ReviewDecidedEventSchema,
    },
    unmatchedEvents: { buffer: false, ttl: '24h' },
    // The selector reads only the context, so the finishing sink stores its output there.
    output: ({ context }) => {
      if (context.result === undefined) throw new Error('Final decision is missing')
      return context.result
    },
  },
  ({ step, view, steps }) => {
    const consent = view({
      description: 'The applicant chooses which records may prefill the application.',
      input: ConsentInputSchema,
      initial: {
        consentToPreviousApplication: false,
        consentToRegistry: false,
        contactEmail: '',
      },
      next: 'prefill',
    })
    const prefill = step({
      description: 'Looks up the registry and any previous application the applicant allowed.',
      needs: { consent },
      run: ({ context, deps, needs, idempotencyKey }) =>
        deps.prefill(context.applicationId, needs.consent, idempotencyKey),
      output: PrefillResultSchema,
      idempotencyKey: ({ context }) => `prefill:${context.applicationId}`,
      // A view's `initial` reads only `context`, so the draft seed is kept there.
      exit: ({ output, update }) => update({ prefill: output }),
      next: 'businessProfile',
    })
    const businessProfile = view({
      description: 'The applicant confirms the prefilled business details and adds figures.',
      needs: { prefill },
      input: BusinessProfileInputSchema,
      initial: ({ context }) => initialBusinessProfile(context.prefill),
      next: ({ output }) =>
        output.legalStructure === 'incorporated' ? 'beneficialOwners' : 'eligibility',
      targets: ['beneficialOwners', 'eligibility'],
    })
    const beneficialOwners = view({
      description: 'An incorporated applicant lists the people who own the business.',
      needs: { businessProfile },
      input: BeneficialOwnersInputSchema,
      initial: { owners: [] },
      next: 'eligibility',
    })
    const eligibility = step({
      description: 'Decides whether the application takes the standard, hardship or appeal path.',
      needs: { businessProfile, prefill, owners: { optional: beneficialOwners } },
      run: async ({ needs }) => evaluateEligibility(needs.businessProfile, needs.prefill.fetchedAt),
      output: EligibilityResultSchema,
      next: 'eligibilityRoute',
    })
    const eligibilityRoute = step({
      description: 'Opens the evidence form that matches the eligibility path.',
      needs: { eligibility },
      next: ({ needs }) => {
        if (needs.eligibility.path === 'standard') return 'standardFinancials'
        if (needs.eligibility.path === 'hardship') return 'hardshipEvidence'
        return 'appeal'
      },
      targets: ['standardFinancials', 'hardshipEvidence', 'appeal'],
    })
    const standardFinancials = view({
      description: 'The applicant reports expenses and cash for the standard path.',
      needs: { eligibilityRoute },
      input: StandardFinancialsInputSchema,
      next: 'documents',
    })
    const hardshipEvidence = view({
      description: 'The applicant describes the hardship and a recovery plan.',
      needs: { eligibilityRoute },
      input: HardshipEvidenceInputSchema,
      next: 'documents',
    })
    const appeal = view({
      description: 'The applicant argues why an ineligible request should still be reviewed.',
      needs: { eligibilityRoute },
      input: AppealInputSchema,
      next: 'documents',
    })
    const documents = view({
      description: 'The applicant attaches supporting documents.',
      needs: { evidence: { any: [standardFinancials, hardshipEvidence, appeal] } },
      input: DocumentsInputSchema,
      // Resetting the draft restores the last submitted list, which `initial` reads from context.
      initial: ({ context }) => context.documents ?? { documents: [] },
      exit: ({ output, update }) => update({ documents: output }),
      next: 'review',
    })
    const review = view({
      description: 'The applicant checks every answer and signs the application.',
      needs: { documents },
      input: ReviewInputSchema,
      // Resetting the draft restores the last signed review, which `initial` reads from context.
      initial: ({ context }) => context.review ?? {},
      exit: ({ output, update }) => update({ review: output }),
      next: 'queueRisk',
    })
    const queueRisk = step({
      description: 'Queues a risk assessment. Each resubmission gets its own job.',
      needs: { review, businessProfile, eligibility, documents },
      run: ({ context, deps, needs, idempotencyKey }) =>
        deps.enqueueRisk(context.applicationId, buildRiskInput(needs), idempotencyKey),
      output: z.string().min(1),
      idempotencyKey: ({ context }) =>
        `risk:${context.applicationId}:${context.changeRequestCount}`,
      next: 'awaitRisk',
    })
    const awaitRisk = step({
      description: 'Waits for the result of the queued risk job and ignores any other job.',
      needs: { riskJobId: queueRisk },
      waitFor: {
        'risk.completed': ({ needs, payload }) =>
          payload.jobId === needs.riskJobId ? { done: payload } : { keep: true as const },
      },
      next: 'riskRoute',
    })
    const riskRoute = step({
      description: 'Approves or rejects on a clear risk result and sends the rest to a reviewer.',
      needs: { risk: awaitRisk },
      next: ({ needs }) => {
        if (needs.risk.outcome === 'approved') return 'approved'
        if (needs.risk.outcome === 'rejected') return 'rejected'
        return 'manualReview'
      },
      targets: ['approved', 'rejected', 'manualReview'],
    })
    const manualReview = step({
      description: 'Waits for a reviewer to approve, reject or request changes.',
      needs: { riskRoute },
      waitFor: {
        'review.decided': ({ payload, update }) => {
          const { reason, requestedFields, decidedAt } = payload
          update((current) =>
            payload.decision === 'request-changes'
              ? {
                  changeRequest: { reason, requestedFields, decidedAt },
                  changeRequestCount: current.changeRequestCount + 1,
                }
              : { changeRequest: undefined },
          )
          return { done: payload }
        },
      },
      next: 'manualRoute',
    })
    const manualRoute = step({
      description: 'Follows the reviewer: finish, or reopen the earliest form they named.',
      needs: { decision: manualReview },
      next: ({ needs }) => {
        if (needs.decision.decision === 'approve') return 'approved'
        if (needs.decision.decision === 'reject') return 'rejected'
        return changeRequestTarget(needs.decision.requestedFields)
      },
      targets: ['approved', 'rejected', ...INTAKE_EDIT_ORDER],
    })
    const approved = step({
      description: 'Records the approval and whether a reviewer or the risk result decided it.',
      needs: { review: { optional: manualReview } },
      run: ({ context, needs }) => finalResult(context.applicationId, 'approved', needs.review),
      exit: ({ output, update }) => update({ result: output }),
    })
    const rejected = step({
      description: 'Records the rejection and whether a reviewer or the risk result decided it.',
      needs: { review: { optional: manualReview } },
      run: ({ context, needs }) => finalResult(context.applicationId, 'rejected', needs.review),
      exit: ({ output, update }) => update({ result: output }),
    })
    return steps(
      {
        consent,
        prefill,
        businessProfile,
        beneficialOwners,
        eligibility,
        eligibilityRoute,
        standardFinancials,
        hardshipEvidence,
        appeal,
        documents,
        review,
        queueRisk,
        awaitRisk,
        riskRoute,
        manualReview,
        manualRoute,
        approved,
        rejected,
      },
      { start: 'consent' },
    )
  },
)

export type IntakeWizard = typeof intakeWizard

function finalResult(
  applicationId: IntakeContext['applicationId'],
  decision: IntakeResult['decision'],
  review: ReviewDecidedEvent | undefined,
): IntakeResult {
  const reviewed =
    (decision === 'approved' && review?.decision === 'approve') ||
    (decision === 'rejected' && review?.decision === 'reject')
  return { applicationId, decision, source: reviewed ? 'reviewer' : 'automatic' }
}
