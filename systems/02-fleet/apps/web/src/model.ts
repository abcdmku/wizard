import type {
  Dashboard,
  Delivery,
  Escalation,
  InterventionAction,
  Vehicle,
} from '@openwizard/fleet-shared'
import {
  DashboardSchema,
  InterventionRequestSchema,
  InterventionResponseSchema,
  LiveDispatchEventSchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'

export type { Dashboard, Delivery, Escalation, InterventionAction, Vehicle }

export const parseDashboard = Schema.decodeUnknownSync(DashboardSchema)
export const parseInterventionRequest = Schema.decodeUnknownSync(InterventionRequestSchema)
export const parseInterventionResponse = Schema.decodeUnknownSync(InterventionResponseSchema)

const parseLiveEvent = Schema.decodeUnknownSync(LiveDispatchEventSchema)

export function parseLivePayload(value: unknown): Dashboard {
  try {
    return parseLiveEvent(value).data
  } catch {
    return parseDashboard(value)
  }
}
