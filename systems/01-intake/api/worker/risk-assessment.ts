import type { RiskCompletedEvent } from '../../shared/index.js'
import { type RiskInput, RiskInputSchema, type RiskOutcome } from '../../shared/index.js'

export type RiskAssessmentOutcome = RiskOutcome

export type RiskAssessment = Pick<RiskCompletedEvent, 'score' | 'outcome' | 'reasons'>

/**
 * Apply the local intake risk policy. The policy is deliberately pure so that
 * retries and restarts produce the same result for the same persisted input.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const value = RiskInputSchema.parse(input)
  let score = 50
  const reasons: string[] = []

  if (value.annualRevenue >= value.requestedAmount * 3) {
    score += 20
  } else {
    reasons.push('requested amount is high relative to annual revenue')
  }
  if (value.tradingMonths >= 24) {
    score += 15
  } else {
    score -= 10
    reasons.push('business has a short trading history')
  }
  if (value.employeeCount > 0) score += 5
  if (value.revenueDropPercent >= 50) score -= 15
  if (value.documentCount === 0) score -= 20

  const boundedScore = Math.max(0, Math.min(100, score))
  const outcome: RiskAssessmentOutcome =
    boundedScore >= 70 ? 'approved' : boundedScore >= 45 ? 'manual-review' : 'rejected'

  return { score: boundedScore, outcome, reasons }
}
