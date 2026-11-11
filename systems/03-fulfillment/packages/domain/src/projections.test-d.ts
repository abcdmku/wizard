import type { CustomerPrincipal, OperatorPrincipal } from '@fulfillment/contracts'
import type { ProjectionScope } from '@openwizard/core'
import type {
  customerOrderProjection,
  operatorOrderProjection,
  PartnerViewer,
  partnerOrderProjection,
} from './projections'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type CustomerScopeMatches = Assert<
  Equal<ProjectionScope<typeof customerOrderProjection>, CustomerPrincipal>
>
export type OperatorScopeMatches = Assert<
  Equal<ProjectionScope<typeof operatorOrderProjection>, OperatorPrincipal>
>
export type PartnerScopeMatches = Assert<
  Equal<ProjectionScope<typeof partnerOrderProjection>, PartnerViewer>
>
