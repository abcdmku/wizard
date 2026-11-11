import * as aws from '@pulumi/aws'
import { settings } from './config'
import { createWorkerLambda, createWorkerRole } from './lambdas'
import { localstackProvider } from './provider'
import { createWorkQueue } from './queues'
import { serviceDefinitions } from './topology'

const orderTopic = createTopic('order', localstackProvider)
const paymentTopic = createTopic('payment', localstackProvider)
const inventoryTopic = createTopic('inventory', localstackProvider)
const shippingTopic = createTopic('shipping', localstackProvider)

const paymentQueue = createWorkQueue(serviceDefinitions.payment, paymentTopic, localstackProvider)
const inventoryQueue = createWorkQueue(
  serviceDefinitions.inventory,
  inventoryTopic,
  localstackProvider,
)
const shippingQueue = createWorkQueue(
  serviceDefinitions.shipping,
  shippingTopic,
  localstackProvider,
)

const workerRole = createWorkerRole(
  [paymentQueue.queue, inventoryQueue.queue, shippingQueue.queue],
  localstackProvider,
)

const paymentWorker = createWorkerLambda(
  serviceDefinitions.payment,
  paymentQueue.queue,
  workerRole,
  localstackProvider,
)
const inventoryWorker = createWorkerLambda(
  serviceDefinitions.inventory,
  inventoryQueue.queue,
  workerRole,
  localstackProvider,
)
const shippingWorker = createWorkerLambda(
  serviceDefinitions.shipping,
  shippingQueue.queue,
  workerRole,
  localstackProvider,
)

export const orderTopicArn = orderTopic.arn
export const paymentTopicArn = paymentTopic.arn
export const inventoryTopicArn = inventoryTopic.arn
export const shippingTopicArn = shippingTopic.arn

export const paymentQueueUrl = paymentQueue.queue.url
export const inventoryQueueUrl = inventoryQueue.queue.url
export const shippingQueueUrl = shippingQueue.queue.url
export const paymentDeadLetterQueueUrl = paymentQueue.deadLetterQueue.url
export const inventoryDeadLetterQueueUrl = inventoryQueue.deadLetterQueue.url
export const shippingDeadLetterQueueUrl = shippingQueue.deadLetterQueue.url

export const paymentWorkerName = paymentWorker.function.name
export const inventoryWorkerName = inventoryWorker.function.name
export const shippingWorkerName = shippingWorker.function.name
export const orchestrationCallbackUrl = settings.orchestrationCallbackUrl

function createTopic(domain: string, provider: aws.Provider): aws.sns.Topic {
  return new aws.sns.Topic(
    `fulfillment-${domain}`,
    {
      name: `fulfillment-${domain}`,
      tags: { system: 'fulfillment', domain, environment: 'local' },
    },
    { provider },
  )
}
