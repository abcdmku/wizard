import { type ScopeProvider, securityRequirement } from './auth'
import { refTo } from './json-schema'
import { camelCase, pascalCase } from './naming'
import {
  errorResponses,
  headerParameter,
  jsonBody,
  jsonResponse,
  pathParameter,
} from './openapi-common'
import type { JSONSchema, OpenAPIOperation } from './openapi-types'
import type { WizardSchemaNames } from './openapi-wizard'

/** Shared inputs of every operation of one generated API. */
export interface OperationContext {
  readonly id: string
  readonly wizardName: string
  readonly names: WizardSchemaNames
  readonly provider: Pick<ScopeProvider<unknown>, 'documentation'>
  readonly scopes: {
    readonly read: readonly string[]
    readonly create: readonly string[]
    readonly command: readonly string[]
  }
}

const RUN_ID = pathParameter('runId', 'Run id.')
const IDEMPOTENCY_KEY = headerParameter(
  'Idempotency-Key',
  'A retry with the same key and body replays the first recorded response, including a refusal.',
  false,
)
const AUTH_ERRORS = { 401: 'Authentication failed.', 403: 'The caller lacks a required scope.' }
const BODY_ERRORS = {
  400: 'The body is not valid JSON or not a valid request.',
  413: 'The body exceeds the size limit.',
  415: 'The body is not JSON.',
}
const UNAVAILABLE =
  'The run is not live here (disposed, or its durable host is busy or lost its lease); retry after Retry-After.'

/** One documented operation: `<id><Method>` operation id, tagged and grouped by the API id. */
export function apiOperation(
  context: Pick<OperationContext, 'id' | 'provider'>,
  method: string,
  scopes: readonly string[],
  fields: Omit<
    OpenAPIOperation,
    'operationId' | 'tags' | 'security' | 'x-fern-sdk-group-name' | 'x-fern-sdk-method-name'
  >,
  group = '',
): OpenAPIOperation {
  const name = camelCase(context.id, 'api')
  return {
    operationId: `${name}${pascalCase(method)}`,
    tags: [group === '' ? context.id : `${context.id}.${group}`],
    security: securityRequirement(context.provider, scopes),
    'x-fern-sdk-group-name': group === '' ? name : `${name}.${group}`,
    'x-fern-sdk-method-name': method,
    'x-required-scopes': scopes,
    ...fields,
  }
}

export function createRunOperation(context: OperationContext): OpenAPIOperation {
  return apiOperation(context, 'createRun', context.scopes.create, {
    summary: `Create a run of ${context.wizardName}`,
    description: `Validates the body against the ${context.wizardName} context schema, creates a run and returns its client state.`,
    parameters: [IDEMPOTENCY_KEY],
    requestBody: jsonBody(context.names.input),
    responses: {
      201: jsonResponse('The run was created.', `${context.names.run}Response`),
      ...errorResponses({
        ...BODY_ERRORS,
        ...AUTH_ERRORS,
        409: 'A request with this idempotency key is still running.',
        422: 'The input does not match the context schema, or the idempotency key belongs to another request.',
        500: 'The run could not be created.',
      }),
    },
  })
}

export function getRunOperation(context: OperationContext): OpenAPIOperation {
  return apiOperation(context, 'getRun', context.scopes.read, {
    summary: `Get a run of ${context.wizardName}`,
    description:
      'Returns the client state of the run: only the context keys, steps and fields this API exposes.',
    parameters: [RUN_ID],
    responses: {
      200: jsonResponse('The run state.', `${context.names.run}Response`),
      ...errorResponses({
        ...AUTH_ERRORS,
        404: 'No such run for this tenant.',
        500: 'The run could not be read.',
      }),
    },
  })
}

export function getStepOperation(
  context: OperationContext,
  steps: readonly string[],
): OpenAPIOperation {
  return apiOperation(context, 'getStep', context.scopes.read, {
    summary: `Get a step of a ${context.wizardName} run`,
    description: 'Returns the state of one exposed step of the run.',
    parameters: [RUN_ID, pathParameter('step', 'Step id.', steps)],
    responses: {
      200: jsonResponse('The step state.', `${context.names.stepState}Response`),
      ...errorResponses({
        ...AUTH_ERRORS,
        404: 'No such run or exposed step.',
        500: 'The run could not be read.',
      }),
    },
  })
}

export function commandOperation(context: OperationContext): OpenAPIOperation {
  return apiOperation(context, 'dispatchCommand', context.scopes.command, {
    summary: `Send a command to a run of ${context.wizardName}`,
    description:
      'Applies one exposed run or step command. The discriminator `type` selects the command.',
    parameters: [RUN_ID, IDEMPOTENCY_KEY],
    requestBody: jsonBody(context.names.command),
    responses: {
      200: jsonResponse('The command was applied.', 'CommandResponse'),
      ...errorResponses({
        ...BODY_ERRORS,
        ...AUTH_ERRORS,
        404: 'No such run for this tenant.',
        409: 'The run rejected the command in its current state, or the idempotency key is in use.',
        422: 'A boundary rejected the command input, or the idempotency key belongs to another request.',
        500: 'The command failed unexpectedly.',
        503: UNAVAILABLE,
      }),
    },
  })
}

export function eventOperation(
  context: OperationContext,
  event: string,
  description: string | undefined,
): OpenAPIOperation {
  return apiOperation(context, `send${pascalCase(event, 'Event')}`, context.scopes.command, {
    summary: `Send ${event} to a run of ${context.wizardName}`,
    description:
      description ??
      `Delivers the ${event} event; the body is its payload. The Idempotency-Key is the event id: the run accepts one event per id.`,
    parameters: [RUN_ID, IDEMPOTENCY_KEY],
    requestBody: jsonBody(context.names.payload(event)),
    responses: {
      200: jsonResponse('The run accepted the event.', 'EventResponse'),
      ...errorResponses({
        ...BODY_ERRORS,
        ...AUTH_ERRORS,
        404: 'No such run for this tenant.',
        409: 'The run dropped the event, or the idempotency key is in use.',
        422: 'The event schema rejected the payload, or the idempotency key belongs to another request.',
        500: 'The event failed unexpectedly.',
        503: UNAVAILABLE,
      }),
    },
  })
}

export function streamOperation(context: OperationContext): OpenAPIOperation {
  return apiOperation(context, 'streamRun', context.scopes.read, {
    summary: `Stream a run of ${context.wizardName}`,
    description:
      'Server-sent events named `frame`: the current client state at once, then one frame per committed change. The stream ends when the run is done, failed or cancelled.',
    parameters: [RUN_ID],
    responses: {
      200: {
        description: 'A stream of run frames.',
        content: { 'text/event-stream': { schema: refTo(context.names.frame) } },
      },
      ...errorResponses({
        ...AUTH_ERRORS,
        404: 'No such run for this tenant.',
        500: 'The stream could not start.',
      }),
    },
    'x-fern-streaming': { format: 'sse' },
  })
}

/** The `Frame` component of the stream route: one SSE `data` payload. */
export function frameSchema(names: WizardSchemaNames): JSONSchema {
  const envelope = {
    instanceId: { type: 'string' },
    epoch: { type: 'integer' },
    seq: { type: 'integer' },
  }
  return {
    description:
      'One Mirror frame: the full client state after a committed change, or a transient hook progress value.',
    discriminator: { propertyName: 'kind' },
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'instanceId', 'epoch', 'seq', 'state'],
        properties: { kind: { const: 'snapshot' }, ...envelope, state: refTo(names.run) },
      },
      {
        type: 'object',
        description: 'A step hook called `progress(value)`; never part of the state.',
        required: ['kind', 'instanceId', 'epoch', 'seq', 'event'],
        properties: {
          kind: { const: 'progress' },
          ...envelope,
          event: {
            type: 'object',
            required: ['type', 'step', 'value', 'seq', 'at', 'path'],
            properties: {
              type: { const: 'step.progress' },
              step: { type: 'string' },
              value: {},
              seq: { type: 'integer' },
              at: { type: 'integer' },
              path: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    ],
  }
}
