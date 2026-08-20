import { createHTTP, type ScopeProvider } from '@openwizard/webhooks'
import type { Principal } from './auth'
import { orderAccess } from './order-access'
import { orderFlow } from './order-flow'
import { runs } from './runs'

export function createOrderHTTP(auth: ScopeProvider<Principal>) {
  return createHTTP(orderFlow, {
    api: { auth, data: runs, access: orderAccess },
  })
}
