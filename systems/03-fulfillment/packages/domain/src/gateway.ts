import type {
  AuthorizePaymentRequest,
  CapturePaymentRequest,
  CreateShipmentRequest,
  PartnerAccepted,
  ReserveInventoryRequest,
  ReversalRequest,
} from '@fulfillment/contracts'

export interface PartnerGateway {
  authorizePayment(input: AuthorizePaymentRequest): Promise<PartnerAccepted>
  reserveInventory(input: ReserveInventoryRequest): Promise<PartnerAccepted>
  capturePayment(input: CapturePaymentRequest): Promise<PartnerAccepted>
  createShipment(input: CreateShipmentRequest): Promise<PartnerAccepted>
  voidAuthorization(input: ReversalRequest): Promise<void>
  releaseInventory(input: ReversalRequest): Promise<void>
  refundPayment(input: ReversalRequest): Promise<void>
  cancelShipment(input: ReversalRequest): Promise<void>
}

export interface FulfillmentDependencies {
  readonly gateway: PartnerGateway
  now(): string
}
