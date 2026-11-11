import { boundary, defineProjection, defineWizard, type Run } from '@openwizard/core'
import { createDurableHost, type DurableHost } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { expectTypeOf } from 'vitest'

const flow = defineWizard(
  {
    name: 'durable-host-types',
    context: boundary.trusted<{ readonly order: string }>(),
    events: { paid: boundary.trusted<{ readonly amount: number }>() },
    deps: boundary.trusted<{ readonly region: string }>(),
  },
  ({ step, steps }) => steps({ pay: step({ waitFor: { paid: () => undefined } }) }),
)
declare const store: DurableStore

const durable = createDurableHost(flow, { store, deps: (key) => ({ region: key }) })
// @ts-expect-error the flow declares deps, so the host needs a deps(key) factory
createDurableHost(flow, { store })
const provided = flow.provide({ region: 'eu-west' })
const providedHost = createDurableHost(provided, {
  store,
  redact(snapshot) {
    expectTypeOf(snapshot.state.context.order).toEqualTypeOf<string>()
    return snapshot
  },
})
expectTypeOf(providedHost).toEqualTypeOf<DurableHost<typeof provided>>()
const baseProjection = defineProjection(flow, { select: (state) => state.context.order })
declare const providedOpen: Awaited<ReturnType<typeof providedHost.open>>
if (providedOpen.ok) {
  expectTypeOf(providedOpen.host.run).toEqualTypeOf<Run<typeof provided>>()
  expectTypeOf(providedOpen.host.run.project(baseProjection)).toEqualTypeOf<string>()
}

const services = defineWizard(
  {
    name: 'durable-partial-services',
    context: boundary.trusted<Record<string, never>>(),
    deps: boundary.trusted<{ readonly region: string; readonly currency: string }>(),
  },
  ({ step, steps }) => steps({ region: step({ run: ({ deps }) => deps.region }) }),
)
const regional = services.provide({ region: 'eu-west' })
createDurableHost(regional, { store, deps: () => ({ currency: 'EUR' }) })
// @ts-expect-error a partial provision still requires the remaining dependency
createDurableHost(regional, { store })
// @ts-expect-error the deps factory must supply currency, which has not been provided
createDurableHost(regional, { store, deps: () => ({ region: 'us-east' }) })

durable.create('order-1', { order: 'A-1' })
// @ts-expect-error the creation input is the flow's context input
durable.create('order-1', { order: 1 })
durable.send('order-1', 'paid', { amount: 1 }, { eventId: 'payment-1' })
// @ts-expect-error a typed payload must match the event
durable.send('order-1', 'paid', { amount: '1' }, { eventId: 'payment-2' })
// @ts-expect-error an excess property is rejected, as on Run.send
durable.send('order-1', 'paid', { amount: 1, extra: true }, { eventId: 'payment-4' })
// @ts-expect-error unknown event names are compile errors
durable.send('order-1', 'refunded', {}, { eventId: 'payment-3' })
durable.dispatch('order-1', { type: 'start' }, { commandId: 'start' })
// @ts-expect-error commands through the host need an id
durable.dispatch('order-1', { type: 'start' }, {})
