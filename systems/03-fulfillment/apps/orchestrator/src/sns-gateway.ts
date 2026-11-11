import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import type {
  AuthorizePaymentRequest,
  CapturePaymentRequest,
  CreateShipmentRequest,
  PartnerAccepted,
  ReserveInventoryRequest,
  ReversalRequest,
  WorkEnvelope,
  WorkType,
} from '@fulfillment/contracts'
import type { PartnerGateway } from '@fulfillment/domain'

type Service = 'payment' | 'inventory' | 'shipping'

interface SnsGatewayOptions {
  readonly endpoint: string
  readonly region: string
  readonly credentials: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
  }
  readonly topics: Readonly<Record<Service, string>>
}

type GatewayRequest =
  | AuthorizePaymentRequest
  | ReserveInventoryRequest
  | CapturePaymentRequest
  | CreateShipmentRequest
  | ReversalRequest

export class SnsPartnerGateway implements PartnerGateway {
  private readonly client: SNSClient

  constructor(private readonly options: SnsGatewayOptions) {
    this.client = new SNSClient({
      endpoint: options.endpoint,
      region: options.region,
      credentials: options.credentials,
    })
  }

  authorizePayment(input: AuthorizePaymentRequest): Promise<PartnerAccepted> {
    return this.publish('payment', 'payment.authorization.requested', input)
  }

  reserveInventory(input: ReserveInventoryRequest): Promise<PartnerAccepted> {
    return this.publish('inventory', 'inventory.reservation.requested', input)
  }

  capturePayment(input: CapturePaymentRequest): Promise<PartnerAccepted> {
    return this.publish('payment', 'payment.capture.requested', input)
  }

  createShipment(input: CreateShipmentRequest): Promise<PartnerAccepted> {
    return this.publish('shipping', 'shipping.requested', input)
  }

  async voidAuthorization(input: ReversalRequest): Promise<void> {
    await this.publish('payment', 'payment.authorization.void.requested', input)
  }

  async releaseInventory(input: ReversalRequest): Promise<void> {
    await this.publish('inventory', 'inventory.release.requested', input)
  }

  async refundPayment(input: ReversalRequest): Promise<void> {
    await this.publish('payment', 'payment.refund.requested', input)
  }

  async cancelShipment(input: ReversalRequest): Promise<void> {
    await this.publish('shipping', 'shipping.cancel.requested', input)
  }

  close(): void {
    this.client.destroy()
  }

  private async publish(
    service: Service,
    type: WorkType,
    input: GatewayRequest,
  ): Promise<PartnerAccepted> {
    const envelope: WorkEnvelope = {
      eventId: input.idempotencyKey,
      orderId: input.orderId,
      tenantId: input.tenantId,
      type,
      attempt: 1,
      occurredAt: new Date().toISOString(),
      data: { ...input },
    }
    const result = await this.client.send(
      new PublishCommand({
        TopicArn: this.options.topics[service],
        Message: JSON.stringify(envelope),
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: type },
        },
      }),
    )
    return { accepted: true, requestId: result.MessageId ?? input.idempotencyKey, duplicate: false }
  }
}
