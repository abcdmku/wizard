import { type PartnerIdentity, type WorkType, workTypesByService } from '@fulfillment/contracts'

export interface ServiceDefinition {
  readonly name: PartnerIdentity
  readonly eventTypes: readonly WorkType[]
}

export const serviceDefinitions: Readonly<Record<PartnerIdentity, ServiceDefinition>> = {
  payment: serviceDefinition('payment'),
  inventory: serviceDefinition('inventory'),
  shipping: serviceDefinition('shipping'),
}

function serviceDefinition(name: PartnerIdentity): ServiceDefinition {
  return { name, eventTypes: workTypesByService[name] }
}
