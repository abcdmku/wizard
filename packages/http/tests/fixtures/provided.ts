import { boundary, defineProjection, defineWizard } from '@openwizard/core'
import { z } from 'zod'

/** A module exports its definition and projection before a host supplies its dependencies. */
export function moduleWizard() {
  return defineWizard(
    {
      name: 'provided-projection',
      context: z.object({ orderId: z.string() }),
      deps: boundary.trusted<{ prefix: string }>(),
      autoRun: 'manual',
    },
    ({ step, steps }) =>
      steps({
        work: step({ run: ({ context, deps }) => `${deps.prefix}:${context.orderId}` }),
      }),
  )
}

export const baseWizard = moduleWizard()
export const baseProjection = defineProjection(baseWizard, {
  expose: { context: ['orderId'], steps: { work: { output: true } } },
})
