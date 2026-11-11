import {
  type AcceptedResponse,
  type ColdChainDrillRequest,
  type Dashboard,
  type DeliverySignal,
  FleetApi,
  type FleetApiError,
  ForbiddenError,
  type InterventionRequest,
  type InterventionResponse,
  type LiveDispatchEvent,
  MalformedRequestError,
  MalformedRequestErrorSchema,
  PersistenceError,
  type SeedResponse,
  type VehicleTelemetry,
  type Viewer,
} from '@openwizard/fleet-shared'
import { Context, Effect, Layer, Stream } from 'effect'
import { HttpApiBuilder, HttpApiMiddleware } from 'effect/unstable/httpapi'
import { FleetAuth, type FleetAuthShape } from './auth'

export type FleetInterventionCommand = InterventionRequest

export interface FleetApplicationShape {
  readonly ready: () => Effect.Effect<boolean, FleetApiError>
  readonly dashboard: (viewer: Viewer) => Effect.Effect<Dashboard, FleetApiError>
  readonly subscribe: (viewer: Viewer) => Stream.Stream<LiveDispatchEvent, FleetApiError>
  readonly intervene: (
    viewer: Viewer,
    deliveryId: string,
    request: FleetInterventionCommand,
  ) => Effect.Effect<InterventionResponse, FleetApiError>
  readonly signal: (
    viewer: Viewer,
    deliveryId: string,
    request: DeliverySignal,
  ) => Effect.Effect<AcceptedResponse, FleetApiError>
  readonly telemetry: (
    viewer: Viewer,
    vehicleId: string,
    request: VehicleTelemetry,
  ) => Effect.Effect<AcceptedResponse, FleetApiError>
  readonly coldChainDrill: (
    viewer: Viewer,
    request: ColdChainDrillRequest,
  ) => Effect.Effect<AcceptedResponse, FleetApiError>
  readonly seed: (viewer: Viewer) => Effect.Effect<SeedResponse, FleetApiError>
}

export class FleetApplication extends Context.Service<FleetApplication, FleetApplicationShape>()(
  'fleet/FleetApplication',
) {}

type Access = 'approve' | 'dispatch' | 'simulate' | 'seed'

function allowed(viewer: Viewer, access: Access): boolean {
  if (access === 'approve') return viewer.role === 'manager'
  if (access === 'dispatch') return viewer.role === 'dispatcher' || viewer.role === 'manager'
  if (access === 'simulate') return viewer.role === 'simulator' || viewer.role === 'seed'
  return viewer.role === 'seed'
}

function authorize(auth: FleetAuthShape, authorization: string | undefined, access: Access) {
  return Effect.flatMap(auth.authenticate(authorization), (viewer) =>
    allowed(viewer, access)
      ? Effect.succeed(viewer)
      : Effect.fail(
          new ForbiddenError({
            code: 'FORBIDDEN',
            message: 'The bearer token cannot perform this operation',
          }),
        ),
  )
}

function malformed(): MalformedRequestError {
  return new MalformedRequestError({
    code: 'MALFORMED_REQUEST',
    message: 'The request body does not match the operation schema',
  })
}

class MalformedRequests extends HttpApiMiddleware.Service<MalformedRequests>()(
  'fleet/MalformedRequests',
  { error: MalformedRequestErrorSchema },
) {}

const ServerFleetApi = FleetApi.middleware(MalformedRequests)
const MalformedRequestsLive = HttpApiMiddleware.layerSchemaErrorTransform(MalformedRequests, () =>
  Effect.fail(malformed()),
)

const PublicHandlers = HttpApiBuilder.group(
  ServerFleetApi,
  'public',
  Effect.fn(function* (handlers) {
    const app = yield* FleetApplication
    return handlers.handle('health', () =>
      Effect.flatMap(app.ready(), (ready) =>
        ready
          ? Effect.succeed({ status: 'ok' })
          : Effect.fail(
              new PersistenceError({
                code: 'NOT_READY',
                message: 'Fleet API startup is not complete',
              }),
            ),
      ),
    )
  }),
)

const FleetHandlers = HttpApiBuilder.group(
  ServerFleetApi,
  'fleet',
  Effect.fn(function* (handlers) {
    const app = yield* FleetApplication
    const auth = yield* FleetAuth
    return handlers
      .handle('dispatch', ({ request }) =>
        Effect.flatMap(authorize(auth, request.headers.authorization, 'dispatch'), app.dashboard),
      )
      .handle('dispatchLive', ({ request }) =>
        Effect.map(authorize(auth, request.headers.authorization, 'dispatch'), (viewer) =>
          app.subscribe(viewer).pipe(Stream.orDie),
        ),
      )
      .handle('intervene', ({ params, payload, request }) =>
        Effect.gen(function* () {
          const viewer = yield* authorize(auth, request.headers.authorization, 'dispatch')
          return yield* app.intervene(viewer, params.id, payload)
        }),
      )
      .handle('signal', ({ params, payload, request }) =>
        Effect.gen(function* () {
          const access =
            payload.signal === 'approval_granted' || payload.signal === 'approval_denied'
              ? 'approve'
              : 'simulate'
          const viewer = yield* authorize(auth, request.headers.authorization, access)
          return yield* app.signal(viewer, params.id, payload)
        }),
      )
      .handle('telemetry', ({ params, payload, request }) =>
        Effect.gen(function* () {
          const viewer = yield* authorize(auth, request.headers.authorization, 'simulate')
          return yield* app.telemetry(viewer, params.id, payload)
        }),
      )
      .handle('coldChainDrill', ({ payload, request }) =>
        Effect.gen(function* () {
          const viewer = yield* authorize(auth, request.headers.authorization, 'simulate')
          return yield* app.coldChainDrill(viewer, payload)
        }),
      )
      .handle('seed', ({ request }) =>
        Effect.flatMap(authorize(auth, request.headers.authorization, 'seed'), app.seed),
      )
  }),
)

const HandlersLive = Layer.merge(PublicHandlers, FleetHandlers).pipe(
  Layer.provide(MalformedRequestsLive),
)

export const FleetHttpApiLive = HttpApiBuilder.layer(ServerFleetApi).pipe(
  Layer.provide(HandlersLive),
)
