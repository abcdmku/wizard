import { defineWizard } from '@openwizard/core'
import { createDeliverySteps } from './delivery-steps'
import { createReadinessSteps } from './readiness-steps'
import { fulfillmentOptions } from './workflow-options'

export const fulfillmentFlow = defineWizard(fulfillmentOptions, ({ step, steps }) =>
  steps({ ...createReadinessSteps(step), ...createDeliverySteps(step) }, { start: 'begin' }),
)
