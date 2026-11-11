import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const delivery = defineWizard(
  { name: 'delivery', context: z.object({ speed: z.enum(['standard', 'express']) }) },
  ({ step, steps }) => {
    const standard = step({ run: async () => '3 to 5 days' })
    const express = step({ run: async () => 'next day' })
    const choose = step({
      targets: [standard, express],
      next: ({ context }) => (context.speed === 'express' ? express : standard),
    })
    return steps({ choose, standard, express })
  },
)
