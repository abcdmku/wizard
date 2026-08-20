/**
 * Shared fixture for the React binding tests: a checkout flow (view → task → final), its
 * client projection, and helpers to build a FlowRun or a loopback Mirror.
 */
import {
  boundary,
  createMirror,
  createMirrorSource,
  createRun,
  defineFlow,
  defineProjection,
  type FlowRun,
  type Mirror,
} from '@openwizard/core'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { z } from 'zod'

export interface Deps {
  inventory: { reserve(cartId: string): Promise<{ reservationId: string }> }
}

const checkout = defineFlow({
  name: 'checkout',
  context: z.object({
    cartId: z.string(),
    total: z.number(),
    express: z.boolean().default(false),
    secret: z.string().default('hunter2'),
  }),
  events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  deps: boundary.trusted<Deps>(),
})

export const checkoutFlow = checkout.steps(
  {
    shipping: checkout.view({
      input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
      exit: ({ output, update }) => update({ express: output.express }),
      next: 'reserve',
    }),
    reserve: checkout.task(({ context, deps }) => deps.inventory.reserve(context.cartId), {
      next: 'receipt',
    }),
    receipt: checkout.final({ output: ({ context }) => ({ cartId: context.cartId }) }),
  },
  { start: 'shipping' },
)

export const checkoutClient = defineProjection(checkoutFlow, {
  expose: {
    steps: { shipping: { input: true }, reserve: { output: true } },
    context: ['total', 'express'],
  },
})

/** Deps whose `reserve` resolves only when the test says so. */
export function controlledDeps() {
  let release: (() => void) | undefined
  const deps: Deps = {
    inventory: {
      reserve: (cartId) =>
        new Promise((resolve) => {
          release = () => resolve({ reservationId: `res-${cartId}` })
        }),
    },
  }
  return { deps, release: () => release?.() }
}

export const instantDeps: Deps = {
  inventory: { reserve: async (cartId) => ({ reservationId: `res-${cartId}` }) },
}

export function makeRun(deps: Deps = instantDeps): FlowRun<typeof checkoutFlow> {
  return createRun(checkoutFlow, {
    context: { cartId: 'c1', total: 10 },
    deps,
    scheduler: createTestScheduler({ now: 1_000 }),
    instanceId: 'wiz-1',
  })
}

/** A started run mirrored through the loopback (frames arrive synchronously). */
export async function makeMirror(deps: Deps = instantDeps): Promise<{
  run: FlowRun<typeof checkoutFlow>
  mirror: Mirror<typeof checkoutClient>
}> {
  const run = makeRun(deps)
  await run.start()
  const source = createMirrorSource(run, checkoutClient)
  const mirror = createMirror<typeof checkoutClient>({ transport: createLocalTransport(source) })
  return { run, mirror }
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
