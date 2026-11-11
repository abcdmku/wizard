import {
  type InterventionAction,
  InterventionActionSchema,
  PriorityBandSchema,
  type Severity,
  SeveritySchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'
import { AutomatedActionSchema } from './delivery-model'

const severityPoints: Readonly<Record<Severity, number>> = {
  low: 1,
  medium: 3,
  high: 5,
  critical: 7,
}

export const EscalationScoreSchema = Schema.Struct({
  severity: SeveritySchema,
  unresolvedSeconds: Schema.Number,
  timerPoints: Schema.Number,
  score: Schema.Number,
  band: PriorityBandSchema,
  actions: Schema.Array(AutomatedActionSchema),
  allowedActions: Schema.Array(InterventionActionSchema),
})
export type EscalationScore = typeof EscalationScoreSchema.Type

export function priorityBand(score: number): typeof PriorityBandSchema.Type {
  if (score >= 8) return 'P0'
  if (score >= 6) return 'P1'
  if (score >= 3) return 'P2'
  return 'P3'
}

export function scoreAnomaly(
  severity: Severity,
  unresolvedSinceMs: number,
  nowMs: number,
): EscalationScore {
  const unresolvedSeconds = Math.max(0, Math.floor((nowMs - unresolvedSinceMs) / 1_000))
  const timerPoints = Math.min(3, Math.floor(unresolvedSeconds / 5))
  const score = severityPoints[severity] + timerPoints
  const band = priorityBand(score)
  return {
    severity,
    unresolvedSeconds,
    timerPoints,
    score,
    band,
    actions: automatedActions(band),
    allowedActions: operatorActions(band),
  }
}

function automatedActions(band: typeof PriorityBandSchema.Type): EscalationScore['actions'] {
  switch (band) {
    case 'P3':
      return ['reroute']
    case 'P2':
      return ['queue']
    case 'P1':
      return ['stop_assignments', 'page_dispatcher']
    case 'P0':
      return ['emergency_stop', 'page_dispatcher', 'page_manager']
  }
}

function operatorActions(band: typeof PriorityBandSchema.Type): readonly InterventionAction[] {
  switch (band) {
    case 'P3':
      return ['reroute']
    case 'P2':
      return ['contact_driver', 'hold']
    case 'P1':
      return ['contact_driver', 'hold', 'reroute']
    case 'P0':
      return ['contact_driver', 'hold', 'cancel']
  }
}
