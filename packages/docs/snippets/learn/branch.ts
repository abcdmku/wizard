import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const delivery = defineWizard(
  { name: 'delivery', context: z.object({ speed: z.enum(['standard', 'express']) }) },
  ({ step, steps }) => {
    const standard = step({ run: () => '3 to 5 days' })
    const express = step({ run: () => 'next day' })
    const choose = step({
      targets: [standard, express],
      next: ({ context }) => (context.speed === 'express' ? express : standard),
    })
    const label = step({
      needs: { eta: { any: [standard, express] } },
      run: ({ needs }) => `Arrives in ${needs.eta}`,
    })
    return steps({ choose, standard, express, label })
  },
)

export const runDelivery = () => delivery.run({ speed: 'express' })
// { status: 'done', output: 'Arrives in next day' }
