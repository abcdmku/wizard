import type { AuthPrincipal } from '@fulfillment/contracts'
import { FulfillmentServiceError } from './errors'

export class BearerAuthenticator {
  constructor(private readonly tokens: Readonly<Record<string, AuthPrincipal>>) {}

  authenticate(
    authorization: string | string[] | undefined,
    role: AuthPrincipal['role'],
  ): AuthPrincipal {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new FulfillmentServiceError('UNAUTHENTICATED', 'Bearer token is required', 401)
    }
    const principal = this.tokens[authorization.slice('Bearer '.length)]
    if (principal === undefined) {
      throw new FulfillmentServiceError('UNAUTHENTICATED', 'Bearer token is invalid', 401)
    }
    if (principal.role !== role) {
      throw new FulfillmentServiceError('FORBIDDEN', 'Principal cannot use this route', 403)
    }
    return principal
  }
}
