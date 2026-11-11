import type { Run } from '@openwizard/core'
import { createBearerScopeProvider, createHTTP } from '@openwizard/http'
import { approval } from '../learn/wait' // the wizard from Wait for events and time

/** Runs by `tenantId/runId`, so one tenant cannot reach the runs of another. */
const runs = new Map<string, Run<typeof approval>>()

export const http = createHTTP(approval, {
  runs: {
    get: ({ tenantId, runId }) => runs.get(`${tenantId}/${runId}`),
    create: async ({ tenantId, input }) => {
      const run = approval.create(input)
      runs.set(`${tenantId}/${run.id}`, run)
      await run.start()
      return run
    },
  },
  auth: createBearerScopeProvider({
    verify: (token) =>
      token === process.env.API_TOKEN
        ? { tenantId: 'acme', principal: 'ops', scopes: ['approval:create', 'approval:read'] }
        : null,
  }),
  access: { run: ['create', 'read'] },
  receive: {
    events: ['approved'],
    secret: process.env.ACME_WEBHOOK_SECRET ?? 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    // Only tenant `acme` has this secret, so its deliveries reach only its runs.
    resolve: ({ envelope }) => runs.get(`acme/${envelope.subject}`),
  },
})

export default { fetch: http.fetch }
