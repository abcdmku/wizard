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
  ({ step, view, steps }) => {
    const consent = view({
      input: ConsentInputSchema,
      initial: {
        consentToPreviousApplication: false,
        consentToRegistry: false,
        contactEmail: '',
      },
      exit: ({ output, update }) => update({ consent: output }),
      next: 'prefill',
    })
    const prefill = step({
      run: ({ context, deps, idempotencyKey }) => {
        if (context.consent === undefined) throw new Error('Consent is missing')
        return deps.prefill(context.applicationId, context.consent, idempotencyKey)
      },
      output: PrefillResultSchema,
      idempotencyKey: ({ context }) => `prefill:${context.applicationId}`,
      exit: ({ output, update }) => update({ prefill: output }),
      next: 'businessProfile',
      needs: { consent },
    })
    const businessProfile = view({
      input: BusinessProfileInputSchema,
      initial: ({ context }) => initialBusinessProfile(context.prefill),
      exit: ({ output, update }) => update({ businessProfile: output }),
      next: ({ output }) =>
        output.legalStructure === 'incorporated' ? 'beneficialOwners' : 'eligibility',
      targets: ['beneficialOwners', 'eligibility'],
      needs: { prefill },
    })
    const beneficialOwners = view({
      input: BeneficialOwnersInputSchema,
      initial: { owners: [] },
      exit: ({ output, update }) => update({ beneficialOwners: output }),
      next: 'eligibility',
      needs: { businessProfile },
    })
    const eligibility = step({
      run: async ({ context }) => evaluateEligibility(context),
      output: EligibilityResultSchema,
      exit: ({ output, update }) => update({ eligibility: output }),
      next: 'eligibilityRoute',
      needs: { profile: { any: [businessProfile, beneficialOwners] } },
    })
    const eligibilityRoute = step({
      next: ({ context }) => {
        if (context.eligibility === undefined) throw new Error('Eligibility result is missing')
        if (context.eligibility.path === 'standard') return 'standardFinancials'
        if (context.eligibility.path === 'hardship') return 'hardshipEvidence'
        return 'appeal'
      },
      targets: ['standardFinancials', 'hardshipEvidence', 'appeal'],
      needs: { eligibility },
    })
    const standardFinancials = view({
      input: StandardFinancialsInputSchema,
      exit: ({ output, update }) => update({ standardFinancials: output }),
      next: 'documents',
      needs: { eligibilityRoute },
    })
    const hardshipEvidence = view({
      input: HardshipEvidenceInputSchema,
      exit: ({ output, update }) => update({ hardshipEvidence: output }),
      next: 'documents',
      needs: { eligibilityRoute },
    })
    const appeal = view({
      input: AppealInputSchema,
      exit: ({ output, update }) => update({ appeal: output }),
      next: 'documents',
      needs: { eligibilityRoute },
    })
    const documents = view({
      input: DocumentsInputSchema,
      initial: ({ context }) => context.documents ?? { documents: [] },
      exit: ({ output, update }) => update({ documents: output }),
      next: 'review',
      needs: { evidence: { any: [standardFinancials, hardshipEvidence, appeal] } },
    })
    const review = view({
      input: ReviewInputSchema,
      initial: ({ context }) => context.review ?? {},
      exit: ({ output, update }) => update({ review: output }),
      next: 'queueRisk',
      needs: { documents },
    })
    const queueRisk = step({
      run: ({ context, deps, idempotencyKey }) =>
        deps.enqueueRisk(context.applicationId, buildRiskInput(context), idempotencyKey),
      output: z.string().min(1),
      idempotencyKey: ({ context }) =>
        `risk:${context.applicationId}:${context.changeRequestCount}`,
      exit: ({ output, update }) => update({ riskJobId: output }),
      next: 'awaitRisk',
      needs: { review },
    })
    const awaitRisk = step({
      waitFor: {
        'risk.completed': ({ context, payload, update }) => {
          if (payload.jobId !== context.riskJobId) return { keep: true }
          update({ risk: payload })
        },
      },
      next: 'riskRoute',
      needs: { queueRisk },
    })
    const riskRoute = step({
      next: ({ context }) => {
        if (context.risk === undefined) throw new Error('Risk result is missing')
        if (context.risk.outcome === 'approved') return 'approved'
        if (context.risk.outcome === 'rejected') return 'rejected'
        return 'manualReview'
      },
      targets: ['approved', 'rejected', 'manualReview'],
      needs: { awaitRisk },
    })
    const manualReview = step({
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
      needs: { riskRoute },
    })
    const manualRoute = step({
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
      needs: { manualReview },
    })
    const approved = step({
      run: ({ context }) => finalResult(context, 'approved'),
    })
    const rejected = step({
      run: ({ context }) => finalResult(context, 'rejected'),
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
