import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const dispatch = defineWizard(
  {
    name: 'dispatch',
    context: z.object({ approved: z.boolean() }),
    events: { audited: z.object({ auditId: z.string() }) },
  },
  ({ step, steps }) => {
    const audit = step({ waitFor: { audited: ({ payload }) => ({ done: payload.auditId }) } })
    const route = step({
      targets: ['ship', 'cancel'],
      next: ({ context }) => (context.approved ? 'ship' : 'cancel'),
    })
    // `route` starts `ship`. The need holds it until the audit is in and never starts it.
    const ship = step({ needs: { audit }, run: ({ needs }) => `shipped under ${needs.audit}` })
    const cancel = step({ run: () => 'cancelled' })
    return steps({ audit, route, ship, cancel }, { start: ['audit', 'route'] })
  },
)
