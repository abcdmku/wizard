import { defineWizard } from '@openwizard/core'
import { createBearerScopeProvider, createHTTP } from '@openwizard/http'
import { z } from 'zod'

const delivery = defineWizard(
  {
    name: 'delivery',
    context: z.object({ packageId: z.string() }),
    events: { delivered: z.object({ signedBy: z.string() }) },
  },
  ({ step, steps }) =>
    steps({
      wait: step({ waitFor: { delivered: () => undefined }, next: 'done' }),
      done: step({ run: () => undefined }),
    }),
)

const run = delivery.create({ packageId: 'pkg-1' })
await run.start() // the wait step must be active before deliveries arrive

export const http = createHTTP(delivery, {
  runs: { get: ({ runId }) => (runId === run.id ? run : undefined) },
  auth: createBearerScopeProvider({
    verify: (token) =>
      token === process.env.API_TOKEN
        ? { tenantId: 'acme', principal: 'ops', scopes: ['delivery:read'] }
        : null,
  }),
  access: { flow: ['read'] },
  receive: {
    events: ['delivered'],
    secret: process.env.CARRIER_SECRET ?? 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    resolve: () => run,
  },
})

// Serve `http.fetch` from any Request → Response runtime; `http.openAPI(info)` is the document.
