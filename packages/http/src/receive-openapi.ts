import type { AnyWizard } from '@openwizard/core'
import { refTo } from './json-schema'
import { camelCase, pascalCase } from './naming'
import { errorResponses, headerParameter, jsonResponse } from './openapi-common'
import type { OpenAPIOperation } from './openapi-types'
import { registerPayload, type WizardDocs } from './openapi-wizard'

/** The documented signed receiver of `event`: tagged and grouped as `<id>.webhooks`. */
export function receiverOperation(
  docs: WizardDocs<AnyWizard>,
  id: string,
  event: string,
): OpenAPIOperation {
  const name = `${docs.names.prefix}${pascalCase(event, 'Event')}Webhook`
  docs.registry.ref(name, {
    type: 'object',
    description: `A signed ${event} delivery.`,
    required: ['type', 'timestamp', 'data'],
    properties: {
      type: { type: 'string', enum: [event] },
      timestamp: { type: 'string', format: 'date-time' },
      subject: { type: 'string', description: 'Optional run key; the default correlation id.' },
      data: registerPayload(docs, event),
    },
  })
  const method = `receive${pascalCase(event, 'Event')}`
  return {
    operationId: `${camelCase(id, 'api')}${pascalCase(method)}`,
    tags: [`${id}.webhooks`],
    summary: `Receive ${event}`,
    description: `Verifies the Standard Webhooks signature, then delivers ${event} to the run the receiver resolves. The webhook-id is the event id: a redelivered message is accepted once.`,
    security: [],
    parameters: [
      headerParameter('webhook-id', 'Message id, the same on every retry of one message.', true),
      headerParameter('webhook-timestamp', 'Attempt time in Unix seconds.', true),
      headerParameter('webhook-signature', 'Space-separated `v1,<base64>` signatures.', true),
    ],
    requestBody: { required: true, content: { 'application/json': { schema: refTo(name) } } },
    responses: {
      200: jsonResponse(
        'The run accepted the event (or had already accepted this webhook-id).',
        'EventResponse',
      ),
      ...errorResponses({
        400: 'The signed body is not a valid envelope or names another event.',
        401: 'The signature headers are missing, stale or invalid.',
        404: 'No run matched this delivery.',
        409: 'The run dropped the event, or this webhook-id is still being processed.',
        413: 'The body exceeds the size limit.',
        415: 'The body is not JSON.',
        422: 'The event schema rejected `data`, or this webhook-id was used for another body.',
        500: 'The receiver failed before the run accepted the event.',
        503: 'The run is not live here (disposed, or its durable host is busy or lost its lease); retry.',
      }),
    },
    'x-fern-sdk-group-name': `${camelCase(id, 'api')}.webhooks`,
    'x-fern-sdk-method-name': method,
    'x-standard-webhooks': '1.0.0',
  }
}
