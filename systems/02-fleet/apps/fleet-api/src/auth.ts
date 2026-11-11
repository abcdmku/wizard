import { PersistenceError, UnauthorizedError, type Viewer } from '@openwizard/fleet-shared'
import { Context, Effect, Layer, Option } from 'effect'
import { FleetRepository } from './database/index.js'

export interface FleetAuthShape {
  readonly authenticate: (
    authorization: string | undefined,
  ) => Effect.Effect<Viewer, UnauthorizedError | PersistenceError>
}

export class FleetAuth extends Context.Service<FleetAuth, FleetAuthShape>()('fleet/FleetAuth') {}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined
  const parts = authorization.trim().split(/\s+/)
  const scheme = parts[0]
  const token = parts[1]
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || parts.length !== 2) {
    return undefined
  }
  return token
}

function unauthorized(): UnauthorizedError {
  return new UnauthorizedError({
    code: 'UNAUTHORIZED',
    message: 'A valid bearer token is required',
  })
}

export const FleetAuthLive = Layer.effect(
  FleetAuth,
  Effect.map(FleetRepository, (repository) =>
    FleetAuth.of({
      authenticate: (authorization) => {
        const token = bearerToken(authorization)
        if (token === undefined) return Effect.fail(unauthorized())
        return repository.findTenantByToken(token).pipe(
          Effect.mapError(
            () =>
              new PersistenceError({
                code: 'AUTH_PERSISTENCE_FAILED',
                message: 'Bearer token lookup failed',
              }),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(unauthorized()),
              onSome: (viewer) => Effect.succeed(viewer),
            }),
          ),
        )
      },
    }),
  ),
)
