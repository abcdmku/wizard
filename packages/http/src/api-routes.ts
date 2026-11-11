import { type AnyWizard, defineProjection, type EventType } from '@openwizard/core'
import { hasCommands, planAccess } from './access'
import type { APIContext, SharedOptions } from './api-context'
import {
  commandOperation,
  createRunOperation,
  eventOperation,
  frameSchema,
  getRunOperation,
  getStepOperation,
  type OperationContext,
  streamOperation,
} from './api-openapi'
import { readRun, readStep, streamRun } from './api-read'
import { createRun, dispatchCommand, dispatchWire, sendEvent } from './api-write'
import { securityScheme, validateProvider, validateScopes } from './auth'
import type { AnyHTTPResource } from './http'
import type { HTTPRunAPIOptions } from './http-options'
import { failure, requirePositiveInteger } from './http-response'
import { refTo } from './json-schema'
import { normalizePrefix } from './naming'
import { registerCommands } from './openapi-commands'
import { envelope } from './openapi-common'
import type { JSONSchema, OpenAPIOperation } from './openapi-types'
import {
  registerInput,
  registerPayload,
  registerRun,
  registerStepState,
  type WizardDocs,
} from './openapi-wizard'
import { parametersOf } from './router'

type Parameters = { readonly [name: string]: string }

/** The run routes of one wizard, registering their component schemas into `docs.registry`. */
export function createRunAPI<F extends AnyWizard, S, P>(
  docs: WizardDocs<F>,
  id: string,
  options: HTTPRunAPIOptions<F, S, P>,
  shared: SharedOptions,
): {
  readonly resources: readonly AnyHTTPResource[]
  readonly securitySchemes: { readonly [name: string]: JSONSchema }
} {
  const { wizard, names, registry } = docs
  validateProvider(options.auth)
  requirePositiveInteger(options.maxBodyBytes, 'maxBodyBytes')
  const plan = planAccess<F>(docs.steps, Object.keys(docs.schemas.events), options.access)
  if (plan.create && typeof options.runs.create !== 'function') {
    throw new TypeError("the 'create' capability requires runs.create")
  }
  const api: APIContext<F, P> = {
    id,
    wizard,
    runs: options.runs,
    auth: options.auth,
    plan,
    projection: options.projection ?? defineProjection(wizard, { expose: plan.expose }),
    basePath: normalizePrefix(options.path ?? `/api/${id}`, 'path'),
    scopes: {
      read: validateScopes(options.scopes?.read ?? [`${id}:read`], 'scopes.read'),
      create: validateScopes(options.scopes?.create ?? [`${id}:create`], 'scopes.create'),
      command: validateScopes(options.scopes?.command ?? [`${id}:command`], 'scopes.command'),
    },
    idempotency: shared.idempotency,
    maxBodyBytes: options.maxBodyBytes ?? 65_536,
    onError: shared.onError,
  }
  const context: OperationContext = {
    id,
    wizardName: wizard.name,
    names,
    provider: options.auth,
    scopes: api.scopes,
  }
  const resources: AnyHTTPResource[] = []
  const route = (
    suffix: string,
    method: AnyHTTPResource['method'],
    name: string,
    openAPI: OpenAPIOperation | undefined,
    handle: (request: Request, parameters: Parameters) => Promise<Response>,
  ) => {
    const resource: AnyHTTPResource = {
      id: `${id}:${name}`,
      method,
      path: `${api.basePath}${suffix}`,
      ...(openAPI === undefined ? {} : { openAPI }),
      handle: (request) => {
        const parameters = parametersOf(resource, request)
        return parameters === undefined
          ? Promise.resolve(failure(404, 'NOT_FOUND', 'no route matches this path'))
          : handle(request, parameters)
      },
    }
    resources.push(resource)
  }
  const runId = (parameters: Parameters) => parameters.runId ?? ''

  if (plan.create) {
    registerInput(docs)
    route('', 'POST', 'createRun', createRunOperation(context), (request) =>
      createRun(api, request),
    )
  }
  if (plan.create || plan.readRun) {
    registerRun(docs, api.projection.expose)
    registry.ref(`${names.run}Response`, envelope('The run state.', refTo(names.run)))
  }
  if (plan.readRun) {
    route('/:runId', 'GET', 'getRun', getRunOperation(context), (request, p) =>
      readRun(api, request, runId(p)),
    )
    registry.ref(names.frame, frameSchema(names))
    route('/:runId/stream', 'GET', 'streamRun', streamOperation(context), (request, p) =>
      streamRun(api, request, runId(p)),
    )
  }
  if (plan.readSteps.length > 0) {
    registerStepState(docs, api.projection.expose, plan.readSteps)
    registry.ref(`${names.stepState}Response`, envelope('The step state.', refTo(names.stepState)))
    route(
      '/:runId/steps/:step',
      'GET',
      'getStep',
      getStepOperation(context, plan.readSteps),
      (request, p) => readStep(api, request, runId(p), p.step ?? ''),
    )
  }
  if (hasCommands(plan)) {
    registerCommands(docs, { run: plan.runCommands, steps: plan.stepCommands })
    route('/:runId/commands', 'POST', 'dispatchCommand', commandOperation(context), (request, p) =>
      dispatchCommand(api, request, runId(p)),
    )
  }
  for (const event of plan.events as readonly EventType<F>[]) {
    registerPayload(docs, event)
    route(
      `/:runId/events/${event}`,
      'POST',
      `send:${event}`,
      eventOperation(context, event, descriptionOf(docs.schemas.events[event])),
      (request, p) => sendEvent(api, request, runId(p), event),
    )
  }
  if (hasCommands(plan) || plan.events.length > 0) {
    // The Mirror wire door of `httpTransport`; a TypeScript-only protocol, so left undocumented.
    route('/:runId/stream', 'POST', 'sendWireCommand', undefined, (request, p) =>
      dispatchWire(api, request, runId(p)),
    )
  }
  if (resources.length === 0) throw new TypeError('access exposes no route')
  return {
    resources,
    securitySchemes: {
      [options.auth.documentation.schemeName]: securityScheme(
        options.auth,
        scopeDescriptions(id, api.scopes),
      ),
    },
  }
}

function descriptionOf(schema: JSONSchema | undefined): string | undefined {
  return typeof schema?.description === 'string' ? schema.description : undefined
}

function scopeDescriptions(
  id: string,
  scopes: APIContext<AnyWizard, unknown>['scopes'],
): { readonly [scope: string]: string } {
  const uses = new Map<string, string[]>()
  const add = (list: readonly string[], use: string) => {
    for (const scope of list) uses.set(scope, [...(uses.get(scope) ?? []), use])
  }
  add(scopes.read, 'reading runs')
  add(scopes.create, 'creating runs')
  add(scopes.command, 'commands and events')
  return Object.fromEntries(
    [...uses].map(([scope, list]) => [scope, `Required for ${list.join(', ')} in the ${id} API.`]),
  )
}
