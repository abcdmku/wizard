import { createRun, defineFlow, type FlowRun } from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  defineWebhook,
  defineWebhooks,
  type VerifiedWebhookDelivery,
  type WebhookResource,
} from '../src'

const builder = defineFlow({
  name: 'typed-webhook',
  context: z.object({ id: z.string() }),
  events: {
    ping: z.object({ id: z.string() }),
    pong: z.object({ id: z.string(), answer: z.number() }),
  },
})
const flow = builder.steps({
  wait: builder.wait({ on: { ping: () => undefined } }),
})
const run = createRun(flow, { context: { id: 'run-1' } })

const ping = defineWebhook({
  flow,
  event: 'ping',
  secret: 'whsec_dGVzdA==',
  resolveRun: (delivery) => {
    expectTypeOf(delivery).toEqualTypeOf<VerifiedWebhookDelivery<'ping'>>()
    expectTypeOf(delivery.envelope.data).toEqualTypeOf<unknown>()
    return run
  },
})

expectTypeOf(ping).toEqualTypeOf<WebhookResource<typeof flow, 'ping'>>()
expectTypeOf(await ping.handle(new Request('https://example.test'))).toEqualTypeOf<Response>()

const resources = defineWebhooks([ping] as const)
expectTypeOf(resources[0]).toEqualTypeOf<typeof ping>()
expectTypeOf(run).toMatchTypeOf<FlowRun<typeof flow>>()

defineWebhook({
  flow,
  // @ts-expect-error event must be declared by this flow
  event: 'missing',
  secret: 'whsec_dGVzdA==',
  resolveRun: () => run,
})
