import { boundary, defineWizard } from '@openwizard/core'
import { createDurableRun, type DurableRunHost, resumeDurableRun } from '@openwizard/durable'
import type { DurableStore, Version } from '@openwizard/durable/store'
import { expectTypeOf } from 'vitest'

const flow = defineWizard(
  {
    name: 'durable-type-test',
    context: boundary.trusted<{ readonly n: number }>(),
    events: { ping: boundary.trusted<{ readonly n: number }>() },
  },
  ({ step, steps }) =>
    steps({
      wait: step({ waitFor: { ping: () => ({ keep: true }) } }),
      done: step({ next: null }),
    }),
)

declare const store: DurableStore
declare const host: DurableRunHost<typeof flow>
declare const body: unknown
const options = { context: { n: 0 }, key: 'run', ownerId: 'owner', store } as const

const services = defineWizard(
  {
    name: 'durable-run-services',
    context: boundary.trusted<{ readonly n: number }>(),
    deps: boundary.trusted<{ readonly region: string; readonly currency: string }>(),
  },
  ({ step, steps }) =>
    steps({ amount: step({ run: ({ context, deps }) => `${context.n} ${deps.currency}` }) }),
)
const regional = services.provide({ region: 'eu-west' })
createDurableRun(regional, { ...options, deps: { currency: 'EUR' } })
// @ts-expect-error a partial provision still requires currency when creating a durable run
createDurableRun(regional, options)
resumeDurableRun(regional, { key: 'run', ownerId: 'owner', store, deps: { currency: 'EUR' } })
// @ts-expect-error restoring also requires dependencies that have not been provided
resumeDurableRun(regional, { key: 'run', ownerId: 'owner', store })
const provided = regional.provide({ currency: 'EUR' })
createDurableRun(provided, options)
resumeDurableRun(provided, { key: 'run', ownerId: 'owner', store })

createDurableRun(flow, { ...options, redact: (snapshot) => snapshot.state.context.n })
// @ts-expect-error the host commits every snapshot itself, so there is no auto-save to debounce
createDurableRun(flow, { ...options, debounceMs: 10 })
// @ts-expect-error a failed commit stops the host (onLeaseLost); no persist-error hook runs
createDurableRun(flow, { ...options, onPersistError: () => undefined })

host.send('ping', { n: 1 }, { eventId: 'event-1' })
host.send('ping', body, { eventId: 'event-2' })
// @ts-expect-error a typed payload must match the event
host.send('ping', { n: 'one' }, { eventId: 'event-3' })
// @ts-expect-error an excess property is rejected, as on Run.send
host.send('ping', { n: 1, extra: true }, { eventId: 'event-6' })
// @ts-expect-error unknown event names are compile errors
host.send('missing', {}, { eventId: 'event-4' })
// @ts-expect-error an event sent through the durable host needs an id
host.send('ping', { n: 1 }, {})
// @ts-expect-error durable commands require a caller-supplied id
host.dispatch({ type: 'start' }, {})

const sent = await host.send('ping', { n: 1 }, { eventId: 'event-5' })
if (sent.ok) {
  expectTypeOf(sent.version).toEqualTypeOf<Version>()
  expectTypeOf(sent.duplicate).toEqualTypeOf<true | undefined>()
}
