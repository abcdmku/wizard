import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { settings } from './config'
import type { ServiceDefinition } from './topology'

const artifactDirectory = fileURLToPath(new URL('../../lambdas/dist/', import.meta.url))

export interface WorkerLambdaResources {
  readonly function: aws.lambda.Function
  readonly eventSourceMapping: aws.lambda.EventSourceMapping
}

export interface WorkerRoleResources {
  readonly role: aws.iam.Role
  readonly policy: aws.iam.RolePolicy
}

export function createWorkerRole(
  queues: readonly aws.sqs.Queue[],
  provider: aws.Provider,
): WorkerRoleResources {
  const assumeRolePolicy = aws.iam.getPolicyDocumentOutput(
    {
      statements: [
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
        },
      ],
    },
    { provider },
  )

  const role = new aws.iam.Role(
    'fulfillment-worker',
    {
      name: 'fulfillment-worker',
      assumeRolePolicy: assumeRolePolicy.json,
      tags: { system: 'fulfillment', environment: 'local' },
    },
    { provider },
  )

  const permissions = aws.iam.getPolicyDocumentOutput(
    {
      statements: [
        {
          sid: 'ConsumeWorkQueues',
          effect: 'Allow',
          actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
          resources: queues.map((queue) => queue.arn),
        },
        {
          sid: 'WriteLambdaLogs',
          effect: 'Allow',
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*'],
        },
      ],
    },
    { provider },
  )

  const policy = new aws.iam.RolePolicy(
    'fulfillment-worker',
    {
      name: 'fulfillment-worker',
      role: role.id,
      policy: permissions.json,
    },
    { provider },
  )

  return { role, policy }
}

export function createWorkerLambda(
  definition: ServiceDefinition,
  queue: aws.sqs.Queue,
  role: WorkerRoleResources,
  provider: aws.Provider,
): WorkerLambdaResources {
  const functionName = `fulfillment-${definition.name}-worker`
  const artifactPath = path.join(artifactDirectory, `${definition.name}.js`)

  const workerFunction = new aws.lambda.Function(
    functionName,
    {
      name: functionName,
      role: role.role.arn,
      runtime: aws.lambda.Runtime.NodeJS22dX,
      handler: 'index.handler',
      architectures: ['x86_64'],
      timeout: settings.lambdaTimeoutSeconds,
      memorySize: 256,
      code: new pulumi.asset.AssetArchive({
        'index.js': new pulumi.asset.FileAsset(artifactPath),
      }),
      environment: {
        variables: {
          PARTNER_API_URL: `${settings.partnerApiBaseUrl}/internal/work/${definition.name}`,
          ORCHESTRATION_CALLBACK_URL: settings.orchestrationCallbackUrl,
          PARTNER_WEBHOOK_SECRET: settings.partnerWebhookSecret,
          REQUEST_TIMEOUT_MS: String(settings.requestTimeoutMilliseconds),
          WORK_SERVICE: definition.name,
        },
      },
      tags: { system: 'fulfillment', service: definition.name, environment: 'local' },
    },
    { dependsOn: [role.policy], provider },
  )

  const eventSourceMapping = new aws.lambda.EventSourceMapping(
    `${functionName}-queue`,
    {
      eventSourceArn: queue.arn,
      functionName: workerFunction.arn,
      batchSize: 10,
      maximumBatchingWindowInSeconds: 1,
      functionResponseTypes: ['ReportBatchItemFailures'],
      enabled: true,
    },
    { dependsOn: [role.policy], provider },
  )

  return { function: workerFunction, eventSourceMapping }
}
