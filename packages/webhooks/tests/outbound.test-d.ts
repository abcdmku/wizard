import { defineFlow, type FlowRun, type RootRunEvent, type RunEvent } from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  createBearerScopeProvider,
  createMemoryWebhookStore,
  createWebhookSubscriptions,
  defineOutboundEvents,
  type RunWebhookAttachment,
  type RunWebhookSubscriptions,
  type WebhookPublishResult,
  type WebhookSubscriptions,
} from '../src'

const events = defineOutboundEvents({
  'order.completed.v1': z.object({ orderId: z.string(), total: z.number() }),
  'order.failed.v1': z.object({ orderId: z.string(), reason: z.string() }),
})
const auth = createBearerScopeProvider({
  verify: () => ({
    tenantId: 'account-1',
    principal: { accountId: 'account-1' },
    scopes: ['orders:webhooks:read'],
  }),
})
const subscriptions = createWebhookSubscriptions({
  id: 'orders',
  events,
  store: createMemoryWebhookStore(),
  api: {
    auth,
  },
})

expectTypeOf(subscriptions).toEqualTypeOf<
  WebhookSubscriptions<typeof events, { accountId: string }>
>()
expectTypeOf(
  subscriptions.publish({
    tenantId: 'account-1',
    type: 'order.completed.v1',
    data: { orderId: 'order-1', total: 42 },
  }),
).toEqualTypeOf<Promise<WebhookPublishResult>>()

subscriptions.publish({
  tenantId: 'account-1',
  type: 'order.completed.v1',
  // @ts-expect-error total comes from the declared Standard Schema
  data: { orderId: 'order-1', total: '42' },
})

subscriptions.publish({
  tenantId: 'account-1',
  // @ts-expect-error event type comes from the public event registry
  type: 'order.refunded.v1',
  data: { orderId: 'order-1', total: 42 },
})

const builder = defineFlow({
  name: 'orders',
  context: z.object({ orderId: z.string() }),
  events: {
    'order.paid': z.object({ paymentId: z.string() }),
  },
})
const flow = builder.steps({
  complete: builder.task(({ context }) => ({ orderId: context.orderId }), { next: 'done' }),
  done: builder.final({ output: ({ context }) => context.orderId }),
})
declare const run: FlowRun<typeof flow>

const inherited = createWebhookSubscriptions(flow, {
  events: ['step.runSucceeded', 'flow.done'],
  store: createMemoryWebhookStore(),
  api: { auth },
})
expectTypeOf(inherited).toEqualTypeOf<RunWebhookSubscriptions<typeof flow, { accountId: string }>>()
expectTypeOf(inherited.attach(run, { tenantId: 'account-1' })).toEqualTypeOf<RunWebhookAttachment>()

const flowDone: Extract<RootRunEvent<typeof flow>, { type: 'flow.done' }> = {
  type: 'flow.done',
  seq: 1,
  at: 1,
  path: [],
  output: 'order-1',
}
expectTypeOf(
  inherited.publish({
    tenantId: 'account-1',
    runId: 'order-1',
    event: flowDone,
  }),
).toEqualTypeOf<Promise<WebhookPublishResult>>()

const received: Extract<
  RootRunEvent<typeof flow>,
  { type: 'event.received'; event: 'order.paid' }
> = {
  type: 'event.received',
  seq: 2,
  at: 2,
  path: [],
  event: 'order.paid',
  payload: { paymentId: 'payment-1' },
  inboxId: 'inbox-1',
}
inherited.publish({ tenantId: 'account-1', runId: 'order-1', event: received })

inherited.publish({
  tenantId: 'account-1',
  runId: 'order-1',
  event: {
    type: 'flow.done',
    seq: 3,
    at: 3,
    path: [],
    // @ts-expect-error flow.done output comes from the final step
    output: 42,
  },
})

inherited.publish({
  tenantId: 'account-1',
  runId: 'order-1',
  event: {
    type: 'event.received',
    seq: 4,
    at: 4,
    path: [],
    event: 'order.paid',
    // @ts-expect-error event payload comes from the flow event schema
    payload: { paymentId: 42 },
    inboxId: 'inbox-2',
  },
})

createWebhookSubscriptions(flow, {
  // @ts-expect-error inherited events are machine event names
  events: ['order.completed.v1'],
  store: createMemoryWebhookStore(),
  api: { auth },
})

const defaultsToInherited = createWebhookSubscriptions(flow, {
  store: createMemoryWebhookStore(),
  api: { auth },
})
expectTypeOf(defaultsToInherited).toEqualTypeOf<
  RunWebhookSubscriptions<typeof flow, { accountId: string }>
>()
expectTypeOf(defaultsToInherited.events).toEqualTypeOf<
  RunWebhookSubscriptions<typeof flow, { accountId: string }>['events']
>()

const otherBuilder = defineFlow({ name: 'other', context: z.object({}) })
const otherFlow = otherBuilder.steps({ done: otherBuilder.final() })
declare const otherRun: FlowRun<typeof otherFlow>
// @ts-expect-error an inherited webhook service only attaches runs of its flow
inherited.attach(otherRun, { tenantId: 'account-1' })

expectTypeOf<Parameters<typeof inherited.publish>[0]['event']>().toEqualTypeOf<
  RunEvent<typeof flow>
>()
