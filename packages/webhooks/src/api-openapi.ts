import type { AnyFlow } from '@openwizard/core'
import type { RunAPICommandOptions, RunAPIDocumentation, ScopeProvider } from './api-types'
import { createCommandSchema } from './command-openapi'

type Operation = Readonly<Record<string, unknown>>

export function createRunReadOperation<P>(
  id: string,
  provider: ScopeProvider<P>,
  requiredScopes: readonly string[],
  documentation: RunAPIDocumentation | undefined,
): Operation {
  return operation({
    ...(documentation?.tags === undefined ? {} : { tags: documentation.tags }),
    summary: documentation?.runSummary ?? 'Get an OpenWizard run',
    operationId: `${operationName(id)}GetRun`,
    provider,
    requiredScopes,
    responses: readResponses(documentation?.runSchema),
  })
}

export function createStepReadOperation<P>(
  id: string,
  steps: readonly string[],
  provider: ScopeProvider<P>,
  requiredScopes: readonly string[],
  documentation: RunAPIDocumentation | undefined,
): Operation {
  return operation({
    ...(documentation?.tags === undefined ? {} : { tags: documentation.tags }),
    summary: documentation?.stepSummary ?? 'Get an OpenWizard step',
    operationId: `${operationName(id)}GetStep`,
    provider,
    requiredScopes,
    parameters: [pathParameter('step', 'Declared flow step.', steps)],
    responses: readResponses(documentation?.stepSchema),
  })
}

export function createCommandOperation<F extends AnyFlow, P>(
  id: string,
  flow: F,
  provider: ScopeProvider<P>,
  requiredScopes: readonly string[],
  commands: RunAPICommandOptions<F, P>,
  documentation: RunAPIDocumentation | undefined,
): Operation {
  return operation({
    ...(documentation?.tags === undefined ? {} : { tags: documentation.tags }),
    summary: documentation?.commandSummary ?? 'Dispatch an OpenWizard command',
    operationId: `${operationName(id)}DispatchCommand`,
    provider,
    requiredScopes,
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: documentation?.commandSchema ?? createCommandSchema(flow),
        },
      },
    },
    responses: {
      200: response('The command completed.', {}),
      400: response('The body is not a command declared by this flow.'),
      401: response('Authentication failed.'),
      403: response(
        'The caller lacks a required scope or the command policy rejected the command.',
      ),
      404: response('No run matched the supplied run id.'),
      409: response('The run rejected the command in its current state.'),
      413: response(`The command body exceeds ${commands.maxBodyBytes ?? 65_536} bytes.`),
      415: response('The request does not use a JSON media type.'),
      422: response('A command boundary rejected its payload.'),
      500: response('The API failed while resolving or calling the run.'),
    },
  })
}

function operation<P>(input: {
  readonly tags?: readonly string[]
  readonly summary: string
  readonly operationId: string
  readonly provider: ScopeProvider<P>
  readonly requiredScopes: readonly string[]
  readonly parameters?: readonly Readonly<Record<string, unknown>>[]
  readonly requestBody?: Readonly<Record<string, unknown>>
  readonly responses: Readonly<Record<string, unknown>>
}): Operation {
  const scheme = input.provider.documentation.securityScheme.type
  const openAPIScopes =
    scheme === 'oauth2' || scheme === 'openIdConnect' ? input.requiredScopes : []
  return {
    tags: input.tags ?? ['OpenWizard runs'],
    summary: input.summary,
    operationId: input.operationId,
    parameters: [
      pathParameter('runId', 'OpenWizard run instance id.'),
      ...(input.parameters ?? []),
    ],
    ...(input.requestBody === undefined ? {} : { requestBody: input.requestBody }),
    security: [{ [input.provider.documentation.schemeName]: openAPIScopes }],
    'x-required-scopes': input.requiredScopes,
    responses: input.responses,
  }
}

function readResponses(dataSchema: Readonly<Record<string, unknown>> | undefined): Operation {
  return {
    200: response('The requested state.', dataSchema ?? {}),
    401: response('Authentication failed.'),
    403: response('The caller lacks a required scope.'),
    404: response('The run or step was not found.'),
    500: response('The API failed while resolving or reading the run.'),
  }
}

function response(description: string, dataSchema?: Readonly<Record<string, unknown>>): Operation {
  const properties: Record<string, unknown> = { ok: { type: 'boolean' } }
  if (dataSchema !== undefined) properties.data = dataSchema
  return {
    description,
    content: {
      'application/json': {
        schema: { type: 'object', properties, required: ['ok'], additionalProperties: true },
      },
    },
  }
}

function pathParameter(name: string, description: string, values?: readonly string[]): Operation {
  return {
    in: 'path',
    name,
    required: true,
    description,
    schema: { type: 'string', minLength: 1, ...(values === undefined ? {} : { enum: values }) },
  }
}

function operationName(id: string): string {
  const name = id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
  return name || 'Run'
}
