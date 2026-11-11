import { FleetRoutes } from '@openwizard/fleet-shared'
import { decodeServerSentEvents } from '@openwizard/http/client'
import {
  type Dashboard,
  type Delivery,
  type InterventionAction,
  parseDashboard,
  parseInterventionRequest,
  parseInterventionResponse,
  parseLivePayload,
} from '../model'
import { endpoint } from './config'

export class FleetApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FleetApiError'
    this.status = status
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response
  let message = `Fleet API returned ${response.status}`
  try {
    const body: unknown = await response.json()
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      message = body.message
    }
  } catch {
    // The status is still useful if the response was not JSON.
  }
  throw new FleetApiError(response.status, message)
}

function fleetEndpoint(route: string): string {
  const path = route.startsWith('/api/') ? route.slice(4) : route
  return endpoint(path)
}

export async function getDashboard(token: string, signal: AbortSignal): Promise<Dashboard> {
  const response = await requireOk(
    await fetch(fleetEndpoint(FleetRoutes.dispatch), {
      headers: authHeaders(token),
      signal,
    }),
  )
  const body: unknown = await response.json()
  return parseDashboard(body)
}

export async function sendIntervention(
  token: string,
  deliveryId: string,
  action: InterventionAction,
  commandId: string,
  reason: string,
  expectedVersion: Delivery['version'],
): Promise<Dashboard> {
  const payload = parseInterventionRequest(
    reason.trim()
      ? { action, commandId, reason: reason.trim(), expectedVersion }
      : { action, commandId, expectedVersion },
  )
  const route = FleetRoutes.intervention.replace(':id', encodeURIComponent(deliveryId))
  const response = await requireOk(
    await fetch(fleetEndpoint(route), {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  )
  const body: unknown = await response.json()
  return parseInterventionResponse(body).dashboard
}

function parseSnapshot(data: string): Dashboard | undefined {
  if (!data || data === '[DONE]') return undefined
  const value: unknown = JSON.parse(data)
  return parseLivePayload(value)
}

export async function* streamDashboards(
  token: string,
  signal: AbortSignal,
): AsyncGenerator<Dashboard> {
  const response = await requireOk(
    await fetch(fleetEndpoint(FleetRoutes.dispatchLive), {
      headers: {
        ...authHeaders(token),
        Accept: 'text/event-stream',
      },
      cache: 'no-store',
      signal,
    }),
  )
  if (!response.body) throw new Error('The live stream returned no body.')

  for await (const event of decodeServerSentEvents(response.body, { signal })) {
    const dashboard = parseSnapshot(event.data)
    if (dashboard) yield dashboard
  }
}
