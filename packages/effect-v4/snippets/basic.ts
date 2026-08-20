import { defineFlow } from '@openwizard/core'
import { makeEffectV4Runner } from '@openwizard/effect-v4'
import { Effect, Layer } from 'effect'
import { z } from 'zod'

const runner = makeEffectV4Runner(Layer.empty)
const orders = defineFlow({
  name: 'effect-v4-orders',
  context: z.object({ orderId: z.string() }),
})
const chargeProgram: Effect.Effect<{ paymentId: string }, { code: string }> = Effect.succeed({
  paymentId: 'payment-42',
})
const charge = runner.task(() => chargeProgram, {
  output: z.object({ paymentId: z.string() }),
  error: z.object({ code: z.string() }),
})

export const orderFlow = orders.steps({
  charge: orders.task(charge, { next: 'done' }),
  done: orders.final(),
})
