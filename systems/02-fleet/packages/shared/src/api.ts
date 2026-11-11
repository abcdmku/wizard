import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { DashboardSchema, LiveDispatchEventSchema } from './domain'
import { FleetApiErrorSchemas } from './errors'
import {
  AcceptedResponseSchema,
  ColdChainDrillRequestSchema,
  DeliverySignalSchema,
  HealthResponseSchema,
  InterventionRequestSchema,
  InterventionResponseSchema,
  SeedResponseSchema,
  VehicleTelemetrySchema,
} from './operations'
import { FleetRoutes } from './routes'

const deliveryParams = { id: Schema.String }
const vehicleParams = { id: Schema.String }

const health = HttpApiEndpoint.get('health', FleetRoutes.health, {
  success: HealthResponseSchema,
  error: FleetApiErrorSchemas,
})

const dispatch = HttpApiEndpoint.get('dispatch', FleetRoutes.dispatch, {
  success: DashboardSchema,
  error: FleetApiErrorSchemas,
})

const dispatchLive = HttpApiEndpoint.get('dispatchLive', FleetRoutes.dispatchLive, {
  success: HttpApiSchema.StreamSse({ data: LiveDispatchEventSchema }),
  error: FleetApiErrorSchemas,
})

const intervene = HttpApiEndpoint.post('intervene', FleetRoutes.intervention, {
  params: deliveryParams,
  payload: InterventionRequestSchema,
  success: InterventionResponseSchema,
  error: FleetApiErrorSchemas,
})

const signal = HttpApiEndpoint.post('signal', FleetRoutes.deliverySignal, {
  params: deliveryParams,
  payload: DeliverySignalSchema,
  success: AcceptedResponseSchema,
  error: FleetApiErrorSchemas,
})

const telemetry = HttpApiEndpoint.post('telemetry', FleetRoutes.vehicleTelemetry, {
  params: vehicleParams,
  payload: VehicleTelemetrySchema,
  success: AcceptedResponseSchema,
  error: FleetApiErrorSchemas,
})

const coldChainDrill = HttpApiEndpoint.post('coldChainDrill', FleetRoutes.coldChainDrill, {
  payload: ColdChainDrillRequestSchema,
  success: AcceptedResponseSchema,
  error: FleetApiErrorSchemas,
})

const seed = HttpApiEndpoint.post('seed', FleetRoutes.seed, {
  success: SeedResponseSchema,
  error: FleetApiErrorSchemas,
})

export const PublicGroup = HttpApiGroup.make('public').add(health)
export const FleetGroup = HttpApiGroup.make('fleet')
  .add(dispatch)
  .add(dispatchLive)
  .add(intervene)
  .add(signal)
  .add(telemetry)
  .add(coldChainDrill)
  .add(seed)

export const FleetApi = HttpApi.make('fleetApi').add(PublicGroup).add(FleetGroup)
