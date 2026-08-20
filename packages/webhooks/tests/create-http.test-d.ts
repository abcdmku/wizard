import { defineFlow, type FlowRun } from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  createBearerScopeProvider,
  createHTTP,
  type VerifiedWebhookDelivery,
  type WizardHTTP,
} from '../src'

const builder = defineFlow({
  name: 'typed-http',
  context: z.object({ accountId: z.string(), internal: z.string() }),
  events: {
    ping: z.object({ id: z.string() }),
    pong: z.object({ answer: z.number() }),
  },
})
const flow = builder.steps({
  form: builder.view({ input: z.object({ name: z.string() }) }),
  load: builder.task(() => 1),
  done: builder.final(),
})
declare const run: FlowRun<typeof flow>
const auth = createBearerScopeProvider({
  verify: () => ({
    tenantId: 'tenant-1',
    principal: { subject: 'user-1' },
    scopes: ['typed-http:read'],
  }),
})

const http = createHTTP(flow, {
  api: {
    auth,
    data: {
      get: (tenantId, runId) => {
        expectTypeOf(tenantId).toEqualTypeOf<string>()
        expectTypeOf(runId).toEqualTypeOf<string>()
        return run
      },
    },
    access: {
      context: ['accountId'],
      flow: ['read', 'start'],
      steps: {
        form: ['input', 'go', 'setInput'],
        load: ['run', 'retry'],
      },
      events: ['ping'],
    },
  },
  receive: {
    secret: 'whsec_dGVzdA==',
    events: ['pong'],
    resolve: (delivery) => {
      expectTypeOf(delivery).toEqualTypeOf<VerifiedWebhookDelivery<'ping' | 'pong'>>()
      return run
    },
  },
})

expectTypeOf(http).toEqualTypeOf<WizardHTTP<typeof flow>>()

createHTTP(flow, {
  api: {
    auth,
    data: { get: () => run },
    // @ts-expect-error step access keys come from the flow
    access: { steps: { missing: ['read'] } },
  },
})

createHTTP(flow, {
  api: {
    auth,
    data: { get: () => run },
    access: {
      steps: {
        // @ts-expect-error task layers do not accept view capabilities
        load: ['setInput'],
      },
    },
  },
})

createHTTP(flow, {
  receive: {
    secret: 'whsec_dGVzdA==',
    resolve: () => run,
    // @ts-expect-error receiver events come from the flow
    events: ['missing'],
  },
})
