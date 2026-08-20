import { createOAuth2ScopeProvider } from '@openwizard/webhooks'
import type { Principal, VerifyAccessToken } from './auth'

export function createOrderOAuth(verifyAccessToken: VerifyAccessToken) {
  return createOAuth2ScopeProvider<Principal>({
    flows: {
      clientCredentials: {
        tokenUrl: 'https://identity.example.com/oauth/token',
        scopes: 'inherit',
      },
    },
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
