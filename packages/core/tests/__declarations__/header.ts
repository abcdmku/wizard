/**
 * Declaration fixture. This folder is a consumer project. It imports the built package and
 * exports a header object, step modules, a wizard, projections and values read from a run.
 * No export has a type annotation. `pnpm test:canary` compiles the folder with
 * `declaration: true` and fails on TS4023 or TS4058. Either code means that an inferred type
 * uses a name the package does not export.
 */
import { boundary, type StepApi, type WizardHeader } from '@openwizard/core'
import { z } from 'zod'

const context = z.object({ orderId: z.string(), note: z.string().optional() })
const events = {
  'payment.settled': z.object({ orderId: z.string(), paymentId: z.string() }),
  'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
}

export type OrderContext = z.infer<typeof context>
export type OrderEvents = { [E in keyof typeof events]: z.infer<(typeof events)[E]> }
export interface OrderDeps {
  readonly charge: (orderId: string, key: string) => Promise<{ readonly paymentId: string }>
}
export type OrderApi = StepApi<OrderContext, OrderEvents, OrderDeps>

/** A header object kept in its own module, with an `on` handler and correlation. */
export const orderHeader = {
  name: 'declaration-order',
  version: 1,
  context,
  deps: boundary.trusted<OrderDeps>(),
  events,
  correlate: {
    'payment.settled': (payload) => payload.orderId,
    'order.cancelled': (payload) => payload.orderId,
  },
  on: {
    'order.cancelled': ({ payload, update }) => {
      update({ note: payload.reason })
      return { cancel: payload.reason }
    },
  },
  unmatchedEvents: { buffer: true, ttl: '30m' },
  onFailure: 'compensate',
} satisfies WizardHeader<OrderContext, z.input<typeof context>, OrderEvents, OrderDeps, never>
