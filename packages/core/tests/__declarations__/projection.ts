import { boundary, defineProjection } from '@openwizard/core'
import { order } from './wizard'

/** A deny-by-default projection. */
export const orderStatus = defineProjection(order, {
  expose: {
    context: ['orderId'],
    output: true,
    progress: true,
    waitingFor: true,
    steps: {
      confirm: { input: true, issues: true },
      charge: { output: true, error: true, progress: true },
      shipTo: { child: { steps: { form: { input: true } } } },
    },
  },
})

/** A mapped projection scoped to a viewer. */
export const orderForViewer = defineProjection(order, {
  scope: boundary.trusted<{ readonly orderId: string }>(),
  select: ({ state, scope }) => {
    if (scope.orderId !== state.context.orderId) return { access: 'forbidden' as const }
    return {
      access: 'granted' as const,
      status: state.status,
      current: state.current,
      charge: state.steps.charge,
      output: state.output,
    }
  },
  progress: { charge: true },
})
