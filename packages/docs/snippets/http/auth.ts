import { createBearerScopeProvider } from '@openwizard/webhooks'

export interface Principal {
  readonly userId: string
}

export interface TokenClaims {
  readonly accountId: string
  readonly subject: string
  readonly scopes: readonly string[]
}

export type VerifyAccessToken = (token: string) => Promise<TokenClaims | null>

export function createOrderAuth(verifyAccessToken: VerifyAccessToken) {
  return createBearerScopeProvider<Principal>({
    verify: async (token) => {
      const claims = await verifyAccessToken(token)
      if (claims === null) return null
      return {
        tenantId: claims.accountId,
        principal: { userId: claims.subject },
        scopes: claims.scopes,
      }
    },
  })
}
