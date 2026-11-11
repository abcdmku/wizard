import { defineWizard, type Run } from '@openwizard/core'
import { z } from 'zod'
import { createBearerScopeProvider, type RunDataLayer } from '../../src'

/** An order: a review view, a wait for the payment, an automatic shipping step. */
export const orders = defineWizard(
  {
    name: 'orders',
    context: z.object({ orderId: z.string(), secret: z.string() }),
    events: { 'payment.captured': z.object({ amount: z.number().int() }) },
  },
  ({ step, view, steps }) =>
    steps({
      review: view({ input: z.object({ note: z.string() }), next: 'payment' }),
      payment: step({ waitFor: { 'payment.captured': () => undefined }, next: 'ship' }),
      ship: step({ run: () => ({ trackingId: 'T-1' }) }),
    }),
)

export type Orders = typeof orders
export interface Principal {
  readonly user: string
}

const ALL = ['orders:read', 'orders:create', 'orders:command']
const IDENTITIES: Readonly<
  Record<string, { tenantId: string; principal: Principal; scopes: string[] }>
> = {
  alice: { tenantId: 'acme', principal: { user: 'alice' }, scopes: ALL },
  bob: { tenantId: 'globex', principal: { user: 'bob' }, scopes: ALL },
  reader: { tenantId: 'acme', principal: { user: 'reader' }, scopes: ['orders:read'] },
}

export const auth = createBearerScopeProvider<Principal>({
  verify: (token) => IDENTITIES[token] ?? null,
})

/** Tenant-scoped in-memory runs: `create` names the run after the Idempotency-Key when given. */
export function memoryRuns(): RunDataLayer<Orders, Principal> & {
  readonly add: (tenantId: string, run: Run<Orders>) => Run<Orders>
} {
  const runs = new Map<string, { readonly tenantId: string; readonly run: Run<Orders> }>()
  const add = (tenantId: string, run: Run<Orders>) => {
    runs.set(run.id, { tenantId, run })
    return run
  }
  return {
    add,
    get: ({ tenantId, runId }) => {
      const entry = runs.get(runId)
      return entry?.tenantId === tenantId ? entry.run : undefined
    },
    create: async ({ tenantId, input, idempotencyKey }) => {
      const run = orders.create(input, { instanceId: idempotencyKey ?? `order-${runs.size + 1}` })
      await run.start()
      return add(tenantId, run)
    },
  }
}

/** A JSON request to `https://api.test<path>` as `token`. */
export function call(
  path: string,
  options: {
    readonly method?: string
    readonly token?: string
    readonly body?: unknown
    readonly headers?: Readonly<Record<string, string>>
  } = {},
): Request {
  return new Request(`https://api.test${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}
