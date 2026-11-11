import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { settings } from './config'
import type { ServiceDefinition } from './topology'

export interface WorkQueueResources {
  readonly queue: aws.sqs.Queue
  readonly deadLetterQueue: aws.sqs.Queue
  readonly subscription: aws.sns.TopicSubscription
}

export function createWorkQueue(
  definition: ServiceDefinition,
  topic: aws.sns.Topic,
  provider: aws.Provider,
): WorkQueueResources {
  const resourceName = `fulfillment-${definition.name}`
  const deadLetterQueue = new aws.sqs.Queue(
    `${resourceName}-dlq`,
    {
      name: `${resourceName}-dlq`,
      messageRetentionSeconds: 1_209_600,
      tags: resourceTags(definition.name, 'dead-letter-queue'),
    },
    { provider },
  )

  const queue = new aws.sqs.Queue(
    `${resourceName}-work`,
    {
      name: `${resourceName}-work`,
      messageRetentionSeconds: 345_600,
      receiveWaitTimeSeconds: 10,
      visibilityTimeoutSeconds: settings.queueVisibilityTimeoutSeconds,
      redrivePolicy: pulumi.jsonStringify({
        deadLetterTargetArn: deadLetterQueue.arn,
        maxReceiveCount: settings.maxReceiveCount,
      }),
      tags: resourceTags(definition.name, 'work-queue'),
    },
    { provider },
  )

  const queuePolicy = allowTopicToSend(`${resourceName}-work`, queue, topic, provider)
  const deadLetterQueuePolicy = allowTopicToSend(
    `${resourceName}-dlq`,
    deadLetterQueue,
    topic,
    provider,
  )

  const subscription = new aws.sns.TopicSubscription(
    `${resourceName}-work`,
    {
      topic: topic.arn,
      protocol: 'sqs',
      endpoint: queue.arn,
      rawMessageDelivery: false,
      filterPolicyScope: 'MessageAttributes',
      filterPolicy: pulumi.jsonStringify({ eventType: definition.eventTypes }),
      redrivePolicy: pulumi.jsonStringify({ deadLetterTargetArn: deadLetterQueue.arn }),
    },
    { dependsOn: [queuePolicy, deadLetterQueuePolicy], provider },
  )

  return { queue, deadLetterQueue, subscription }
}

function allowTopicToSend(
  name: string,
  queue: aws.sqs.Queue,
  topic: aws.sns.Topic,
  provider: aws.Provider,
): aws.sqs.QueuePolicy {
  const policy = aws.iam.getPolicyDocumentOutput(
    {
      statements: [
        {
          sid: 'AllowMatchingSnsTopic',
          effect: 'Allow',
          actions: ['sqs:SendMessage'],
          resources: [queue.arn],
          principals: [{ type: 'Service', identifiers: ['sns.amazonaws.com'] }],
          conditions: [{ test: 'ArnEquals', variable: 'aws:SourceArn', values: [topic.arn] }],
        },
      ],
    },
    { provider },
  )

  return new aws.sqs.QueuePolicy(
    `${name}-sns-policy`,
    {
      queueUrl: queue.id,
      policy: policy.json,
    },
    { provider },
  )
}

function resourceTags(service: string, purpose: string): Record<string, string> {
  return {
    system: 'fulfillment',
    service,
    purpose,
    environment: 'local',
  }
}
