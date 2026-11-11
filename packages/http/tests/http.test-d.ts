import { boundary, defineProjection, defineWizard, type RequiredDepsOf } from '@openwizard/core'
import { createMirror } from '@openwizard/core/mirror'
import type { DurableRunHost } from '@openwizard/durable'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  createHTTP,
  createMemoryWebhookStore,
  createWebhookSubscriptions,
  type RunHandle,
} from '../src'
import { httpTransport } from '../src/client'
import { auth, memoryRuns, type Orders, orders, type Principal } from './fixtures/orders'
import { baseProjection, baseWizard } from './fixtures/provided'

const runs = memoryRuns()

// Access is checked against the flow: steps, step capabilities, events and context keys.
createHTTP(orders, {
  runs,
  auth,
  access: {
    context: ['orderId'],
    steps: { review: ['read', 'setInput'], ship: ['retry'] },
    events: ['payment.captured'],
  },
})
// @ts-expect-error unknown step
createHTTP(orders, { runs, auth, access: { steps: { reveiw: ['read'] } } })
// @ts-expect-error a view has no run hook to retry
createHTTP(orders, { runs, auth, access: { steps: { review: ['retry'] } } })
// @ts-expect-error unknown event
createHTTP(orders, { runs, auth, access: { events: ['payment.refunded'] } })
// @ts-expect-error unknown context key
createHTTP(orders, { runs, auth, access: { context: ['total'] } })
// @ts-expect-error the run API needs access next to runs and auth
createHTTP(orders, { runs, auth })

// Old run command names are absent from the access contract.
// @ts-expect-error startReady is the flow command
createHTTP(orders, { runs, auth, access: { run: ['runReady'] } })
// @ts-expect-error startStep is the step command
createHTTP(orders, { runs, auth, access: { steps: { ship: ['run'] } } })

// The data layer sees the scope provider's principal.
createHTTP(orders, {
  auth,
  access: { run: ['read'] },
  runs: {
    get: ({ principal }) => {
      expectTypeOf(principal).toEqualTypeOf<Principal>()
      return undefined
    },
  },
})

// A durable host is a run handle: commands and events go through its lease and dedupe.
expectTypeOf<DurableRunHost<Orders>>().toExtend<RunHandle<Orders>>()

const withDeps = defineWizard(
  { name: 'provided', context: z.object({}), deps: boundary.trusted<{ token: string }>() },
  ({ step, steps }) => steps({ read: step({ run: ({ deps }) => deps.token }) }),
).provide({ token: 'bound' })
expectTypeOf<RequiredDepsOf<typeof withDeps>>().toEqualTypeOf<{}>()
const providedHTTP = createHTTP(withDeps, {
  auth,
  access: { run: ['create'] },
  runs: { get: () => undefined, create: ({ input }) => withDeps.create(input) },
})
expectTypeOf(providedHTTP.wizard).toEqualTypeOf<typeof withDeps>()

const moduleBound = baseWizard.provide({ prefix: 'bound' })
const projectedHTTP = createHTTP(moduleBound, {
  auth,
  projection: baseProjection,
  access: { run: ['read'] },
  runs: { get: () => moduleBound.create({ orderId: 'o-1' }) },
})
expectTypeOf(projectedHTTP.wizard).toEqualTypeOf<typeof moduleBound>()
const moduleMirror = createMirror<typeof baseProjection>({
  transport: httpTransport('https://api.test/stream'),
})
expectTypeOf(moduleMirror.getSnapshot()?.context).toEqualTypeOf<{ orderId: string } | undefined>()
expectTypeOf(moduleMirror.getSnapshot()?.steps.work.output).toEqualTypeOf<string | undefined>()

const differentContext = defineWizard(
  { name: 'different', context: z.object({ total: z.number() }) },
  ({ step, steps }) => steps({ work: step({ run: ({ context }) => context.total }) }),
)
createHTTP(differentContext, {
  auth,
  access: { run: ['read'] },
  runs: { get: () => differentContext.create({ total: 1 }) },
  // @ts-expect-error providing dependencies cannot make a projection compatible with different data
  projection: baseProjection,
})

// The client is typed by the projection, with no code generation.
const projection = defineProjection(orders, { expose: { context: ['orderId'] } })
const mirror = createMirror<typeof projection>({
  transport: httpTransport('https://api.test/api/orders/o-1/stream'),
})
expectTypeOf(mirror.getSnapshot()?.context).toEqualTypeOf<{ orderId: string } | undefined>()
mirror.send('payment.captured', { amount: 4200 })
// @ts-expect-error the payload is checked against the event schema
mirror.send('payment.captured', { amount: 'all' })

// Outbound events are an allowlist with typed data.
const subscriptions = createWebhookSubscriptions({
  id: 'orders',
  events: { 'order.shipped': z.object({ orderId: z.string() }) },
  store: createMemoryWebhookStore(),
  auth,
})
subscriptions.publish({ tenantId: 'acme', type: 'order.shipped', data: { orderId: 'o-1' } })
// @ts-expect-error only declared events are published
subscriptions.publish({ tenantId: 'acme', type: 'order.lost', data: { orderId: 'o-1' } })
// @ts-expect-error data follows the event schema
subscriptions.publish({ tenantId: 'acme', type: 'order.shipped', data: { orderId: 1 } })
