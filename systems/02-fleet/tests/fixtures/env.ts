import {
  FleetDemoTokens,
  type InterventionRequest,
  InterventionRequestSchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'

export interface FleetTestEnv {
  readonly integration: boolean
  readonly apiUrl: string
  readonly webUrl: string
  readonly dispatchToken: string
  readonly simulatorToken: string
  readonly secondaryToken: string
  readonly deliveryId: string
  readonly secondaryDeliveryId: string
  readonly interventionBody: InterventionRequest
}

function text(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value === undefined || value.length === 0 ? fallback : value
}

const decodeIntervention = Schema.decodeUnknownSync(InterventionRequestSchema)

function intervention(name: string): InterventionRequest {
  const fallback = {
    action: 'hold',
    reason: 'cold-chain drill',
    commandId: 'cold-chain-drill-001',
  } satisfies InterventionRequest
  const value = process.env[name]
  if (value === undefined) return fallback
  try {
    return decodeIntervention(JSON.parse(value))
  } catch {
    return fallback
  }
}

export const fleetEnv: FleetTestEnv = {
  integration: process.env.FLEET_INTEGRATION === '1',
  apiUrl: text('FLEET_API_URL', 'http://127.0.0.1:8787'),
  webUrl: text('FLEET_WEB_URL', 'http://127.0.0.1:3000'),
  dispatchToken: text('FLEET_DISPATCH_TOKEN', text('FLEET_SEED_TOKEN', FleetDemoTokens.lakeshore)),
  simulatorToken: text('FLEET_SIMULATOR_TOKEN', FleetDemoTokens.lakeshoreSimulator),
  secondaryToken: text('FLEET_SECONDARY_TOKEN', FleetDemoTokens.redwood),
  deliveryId: text('FLEET_DELIVERY_ID', 'delivery-1'),
  secondaryDeliveryId: text('FLEET_SECONDARY_DELIVERY_ID', 'delivery-2'),
  interventionBody: intervention('FLEET_INTERVENTION_BODY'),
}
