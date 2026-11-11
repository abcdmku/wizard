import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { integrationReady } from './support/http'
import { localstack } from './support/localstack'

const paymentTopicArn = 'arn:aws:sns:us-east-1:000000000000:fulfillment-payment'

describe.skipIf(!integrationReady)('SNS filter delivery', () => {
  it('delivers only matching message attributes to a scoped SQS queue', async () => {
    const queueName = `qa-filter-${randomUUID()}`
    const temporaryQueue = await localstack([
      'sqs',
      'create-queue',
      '--queue-name',
      queueName,
      '--query',
      'QueueUrl',
      '--output',
      'text',
    ])
    if (temporaryQueue.length === 0)
      throw new Error('LocalStack did not create the temporary filter queue')
    const queueArn = await localstack([
      'sqs',
      'get-queue-attributes',
      '--queue-url',
      temporaryQueue,
      '--attribute-names',
      'QueueArn',
      '--query',
      'Attributes.QueueArn',
      '--output',
      'text',
    ])
    if (queueArn.length === 0) throw new Error('LocalStack did not return the temporary queue ARN')
    let subscriptionArn: string | undefined
    try {
      await localstack([
        'sqs',
        'set-queue-attributes',
        '--queue-url',
        temporaryQueue,
        '--attributes',
        JSON.stringify({
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'AllowPaymentTopic',
                Effect: 'Allow',
                Principal: '*',
                Action: 'sqs:SendMessage',
                Resource: queueArn,
                Condition: { ArnEquals: { 'aws:SourceArn': paymentTopicArn } },
              },
            ],
          }),
        }),
      ])
      subscriptionArn = await localstack([
        'sns',
        'subscribe',
        '--topic-arn',
        paymentTopicArn,
        '--protocol',
        'sqs',
        '--notification-endpoint',
        queueArn,
        '--attributes',
        JSON.stringify({
          RawMessageDelivery: 'false',
          FilterPolicyScope: 'MessageAttributes',
          FilterPolicy: JSON.stringify({ eventType: ['payment.authorization.requested'] }),
        }),
        '--query',
        'SubscriptionArn',
        '--output',
        'text',
      ])
      if (subscriptionArn.length === 0)
        throw new Error('LocalStack did not return a subscription ARN')
      const paymentMarker = `payment-marker-${randomUUID()}`
      const inventoryMarker = `inventory-marker-${randomUUID()}`
      const attribute = (eventType: string) =>
        JSON.stringify({ eventType: { DataType: 'String', StringValue: eventType } })
      await localstack([
        'sns',
        'publish',
        '--topic-arn',
        paymentTopicArn,
        '--message',
        paymentMarker,
        '--message-attributes',
        attribute('payment.authorization.requested'),
      ])
      await localstack([
        'sns',
        'publish',
        '--topic-arn',
        paymentTopicArn,
        '--message',
        inventoryMarker,
        '--message-attributes',
        attribute('inventory.reservation.requested'),
      ])
      const received = await localstack([
        'sqs',
        'receive-message',
        '--queue-url',
        temporaryQueue,
        '--wait-time-seconds',
        '3',
        '--max-number-of-messages',
        '10',
      ])
      expect(received).toContain(paymentMarker)
      expect(received).not.toContain(inventoryMarker)
    } finally {
      if (subscriptionArn !== undefined)
        await localstack(['sns', 'unsubscribe', '--subscription-arn', subscriptionArn])
      await localstack(['sqs', 'delete-queue', '--queue-url', temporaryQueue])
    }
  })
})
