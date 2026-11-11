import { defineWizard } from '@openwizard/core'
import { createDeliverySteps } from './delivery-steps'
import { createReadinessSteps } from './readiness-steps'
import { fulfillmentOptions } from './wizard-options'

export const fulfillmentWizard = defineWizard(fulfillmentOptions, ({ step, steps }) => {
  const readiness = createReadinessSteps(step)
  return steps({ ...readiness, ...createDeliverySteps(step, readiness) }, { start: 'begin' })
})
