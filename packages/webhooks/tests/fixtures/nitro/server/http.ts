import { boundary, createRun, defineFlow } from '@openwizard/core'
import { createBearerScopeProvider, createHTTP } from '@openwizard/webhooks'

const builder = defineFlow({
  name: 'orders',
  context: boundary.trusted<{ readonly orderId: string }>(),
  autoRun: 'manual',
  events: {
    'shipment.ready': boundary.trusted<{ readonly shipmentId: string }>(),
  },
})
const flow = builder.steps({
  load: builder.task(() => ({ total: 42 })),
  done: builder.final(),
})
const run = createRun(flow, { context: { orderId: 'order-1' }, instanceId: 'order-1' })
const auth = createBearerScopeProvider({
  verify: (token) =>
    token === 'fixture-token'
      ? {
          tenantId: 'acct-1',
          principal: { accountId: 'acct-1' },
          scopes: ['orders:read', 'orders:command'],
        }
      : null,
})

export const http = createHTTP(flow, {
  api: {
    auth,
    data: { get: (_tenantId, runId) => (runId === run.id ? run : undefined) },
    access: {
      context: ['orderId'],
      steps: { load: ['output', 'run'] },
    },
  },
  receive: {
    secret: 'whsec_Zml4dHVyZS1zaWduaW5nLXNlY3JldA==',
    resolve: () => run,
  },
})
