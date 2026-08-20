import type { WebhookDocumentation, WebhookOpenAPIOperation } from './types'

export function createOpenAPIOperation(
  event: string,
  documentation: WebhookDocumentation | undefined,
): WebhookOpenAPIOperation {
  const dataSchema = documentation?.dataSchema ?? {}
  const data =
    documentation?.dataExample === undefined
      ? dataSchema
      : { ...dataSchema, example: documentation.dataExample }

  return {
    tags: documentation?.tags ?? ['Webhooks'],
    summary: documentation?.summary ?? `Receive ${event}`,
    description:
      documentation?.description ??
      `Receives the ${event} event, verifies its Standard Webhooks signature, and sends its data through the OpenWizard event boundary.`,
    operationId: documentation?.operationId ?? operationId(event),
    parameters: [
      header(
        'webhook-id',
        'Stable message id. Receivers use it to suppress duplicate delivery when an idempotency store is configured.',
      ),
      header(
        'webhook-timestamp',
        'Unix timestamp in seconds for this delivery attempt. The signature verifier rejects stale attempts.',
      ),
      header(
        'webhook-signature',
        'Space-delimited Standard Webhooks signatures, such as `v1,<base64-signature>`.',
      ),
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: true,
            required: ['type', 'timestamp', 'data'],
            properties: {
              type: { type: 'string', const: event },
              timestamp: { type: 'string', format: 'date-time' },
              subject: {
                type: 'string',
                description: 'Optional run key and default OpenWizard correlation id.',
              },
              data,
            },
          },
        },
      },
    },
    responses: {
      202: response('The verified event was delivered or buffered by the run.'),
      200: response('The message id was already claimed, so the duplicate was acknowledged.'),
      400: response('The signed JSON envelope is malformed or names another event.'),
      401: response('Required signature headers are missing, stale, or invalid.'),
      404: response('The resolver could not find a run for this delivery.'),
      409: response('The run dropped the event.'),
      413: response("The request body exceeds this resource's configured limit."),
      415: response('The request does not use a JSON media type.'),
      422: response('The flow event boundary rejected `data`.'),
      500: response('The receiver failed before OpenWizard accepted the event.'),
    },
    'x-standard-webhooks': '1.0.0',
  }
}

function header(name: string, description: string): Readonly<Record<string, unknown>> {
  return {
    in: 'header',
    name,
    required: true,
    description,
    schema: { type: 'string', minLength: 1 },
  }
}

function response(description: string): Readonly<Record<string, unknown>> {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['ok'],
          properties: { ok: { type: 'boolean' } },
          additionalProperties: true,
        },
      },
    },
  }
}

function operationId(event: string): string {
  const name = event
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
  return `receive${name || 'Event'}Webhook`
}
