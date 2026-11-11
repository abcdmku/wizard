import type { Snapshot } from '@openwizard/core'
import type { ApplicationStatus } from '../../shared/index.js'
import type { IntakeFlow } from './flow.js'
import { statusForCurrentStep } from './routing.js'

export type IntakeState = Snapshot<IntakeFlow>['state']

export function applicationStatus(state: IntakeState): ApplicationStatus {
  if (state.status === 'cancelled') return 'cancelled'
  if (state.status === 'failed') return 'failed'
  if (state.output?.decision === 'approved') return 'approved'
  if (state.output?.decision === 'rejected') return 'rejected'
  if (state.steps.prefill.status === 'active') return 'prefilling'
  if (
    state.steps.eligibility.status === 'active' ||
    state.steps.eligibilityRoute.status === 'active'
  ) {
    return 'eligibility-pending'
  }
  if (
    state.steps.queueRisk.status === 'active' ||
    state.steps.awaitRisk.status === 'active' ||
    state.steps.riskRoute.status === 'active'
  ) {
    return 'risk-review'
  }
  if (state.steps.manualReview.status === 'active' || state.steps.manualRoute.status === 'active') {
    return 'awaiting-reviewer'
  }
  if (
    state.context.reviewerDecision?.decision === 'request-changes' &&
    state.current === 'documents'
  ) {
    return 'changes-requested'
  }
  return statusForCurrentStep(state.current)
}
