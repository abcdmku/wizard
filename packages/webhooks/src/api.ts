import { type AnyFlow, parseCommand, type StepId } from '@openwizard/core'
import {
  createCommandOperation,
  createRunReadOperation,
  createStepReadOperation,
} from './api-openapi'
import type {
  RunAPI,
  RunAPICommandContext,
  RunAPIOptions,
  RunAPIResolveContext,
  ScopeIdentity,
} from './api-types'
import { type AnyHTTPResource, defineHTTPResources } from './http'

const DEFAULT_COMMAND_BODY_BYTES = 65_536

/**
 * Define authenticated run, step, and optional command resources for one OpenWizard flow.
 * @public
 */
export function defineRunAPI<F extends AnyFlow, S, P>(
  options: RunAPIOptions<F, S, P>,
): RunAPI<F, S, P> {
  const id = options.id ?? options.flow.name
  requireNonEmpty(id, 'run API id')
  const basePath = normalizeBasePath(options.basePath ?? `/api/${id}`)
  requireProvider(options)
  if (options.projection.flow !== options.flow) {
    throw new TypeError('run API projection must be defined for the same flow object')
  }
  const availableSteps = Object.keys(options.flow.steps) as StepId<F>[]
  const readSteps = options.readSteps === undefined ? availableSteps : [...options.readSteps]
  validateReadSteps(availableSteps, readSteps)

  const runScopes = scopes(options.readScopes?.run, `${id}:read`)
  const stepScopes = options.readScopes?.step ?? runScopes
  validateScopes(stepScopes)
  const commandScopes =
    options.commands === undefined ? undefined : (options.commands.scopes ?? [`${id}:command`])
  if (commandScopes !== undefined) {
    validateScopes(commandScopes)
    validateMaxBody(options.commands?.maxBodyBytes)
  }
  const documentedScopes = scopeDescriptions(id, [
    ...(options.readRun === false ? [] : [{ scopes: runScopes, use: 'run reads' }]),
    ...(readSteps.length === 0 ? [] : [{ scopes: stepScopes, use: 'step reads' }]),
    ...(commandScopes === undefined ? [] : [{ scopes: commandScopes, use: 'command dispatch' }]),
  ])
  const components = {
    securitySchemes: {
      [options.scopeProvider.documentation.schemeName]: inheritOAuthScopes(
        options.scopeProvider.documentation.securityScheme,
        documentedScopes,
      ),
    },
  }
  const runPath = `${basePath}/:runId`
  const stepPath = `${basePath}/:runId/steps/:step`
  const resources: AnyHTTPResource[] = []
  if (options.readRun !== false) {
    resources.push({
      id: `${id}:run:read`,
      path: runPath,
      openAPIPath: toOpenAPIPath(runPath),
      method: 'GET',
      openAPI: createRunReadOperation(id, options.scopeProvider, runScopes, options.documentation),
      openAPIComponents: components,
      handle: (request) => readRun(request, options, basePath, runScopes),
    })
  }
  if (readSteps.length > 0) {
    resources.push({
      id: `${id}:step:read`,
      path: stepPath,
      openAPIPath: toOpenAPIPath(stepPath),
      method: 'GET',
      openAPI: createStepReadOperation(
        id,
        readSteps,
        options.scopeProvider,
        stepScopes,
        options.documentation,
      ),
      openAPIComponents: components,
      handle: (request) => readStep(request, options, basePath, stepScopes, readSteps),
    })
  }

  if (options.commands !== undefined && commandScopes !== undefined) {
    const commandPath = `${basePath}/:runId/commands`
    resources.push({
      id: `${id}:command`,
      path: commandPath,
      openAPIPath: toOpenAPIPath(commandPath),
      method: 'POST',
      openAPI: createCommandOperation(
        id,
        options.flow,
        options.scopeProvider,
        commandScopes,
        options.commands,
        options.documentation,
      ),
      openAPIComponents: components,
      handle: (request) => dispatchCommand(request, options, basePath),
    })
  }

  if (resources.length === 0) throw new TypeError('run API generated no resources')

  const api: RunAPI<F, S, P> = {
    id,
    flow: options.flow,
    basePath,
    resources: defineHTTPResources(resources),
    '~types': undefined,
  }
  return Object.freeze(api)
}

async function readRun<F extends AnyFlow, S, P>(
  request: Request,
  options: RunAPIOptions<F, S, P>,
  basePath: string,
  requiredScopes: readonly string[],
): Promise<Response> {
  if (request.method.toUpperCase() !== 'GET') return methodNotAllowed('GET')
  const runId = routeParameters(request, basePath, [])?.runId
  if (runId === undefined) return notFound()
  const access = await authenticate(request, options, 'run:read', runId, requiredScopes)
  if (access instanceof Response) return access
  try {
    const context = resolveContext(request, runId, access)
    const run = await options.resolveRun(context)
    if (run === null || run === undefined) return notFound()
    return json(200, { ok: true, data: run.project(options.projection) })
  } catch (error) {
    return unexpected(error, request, options, 'run:read', runId)
  }
}

async function readStep<F extends AnyFlow, S, P>(
  request: Request,
  options: RunAPIOptions<F, S, P>,
  basePath: string,
  requiredScopes: readonly string[],
  readSteps: readonly StepId<F>[],
): Promise<Response> {
  if (request.method.toUpperCase() !== 'GET') return methodNotAllowed('GET')
  const parameters = routeParameters(request, basePath, ['steps', ':step'])
  if (parameters === undefined) return notFound()
  const { runId } = parameters
  const access = await authenticate(request, options, 'step:read', runId, requiredScopes)
  if (access instanceof Response) return access
  const step = parameters.values.step
  if (step === undefined || !readSteps.includes(step as StepId<F>)) return notFound()
  const typedStep = step as StepId<F>
  try {
    const context = resolveContext(request, runId, access)
    const run = await options.resolveRun(context)
    if (run === null || run === undefined) return notFound()
    const projected = run.project(options.projection)
    const data =
      options.selectStep === undefined
        ? defaultStepProjection(projected, run.getState().steps[typedStep])
        : await options.selectStep({ ...context, run, step: typedStep, projected })
    return json(200, { ok: true, data })
  } catch (error) {
    return unexpected(error, request, options, 'step:read', runId)
  }
}

async function dispatchCommand<F extends AnyFlow, S, P>(
  request: Request,
  options: RunAPIOptions<F, S, P>,
  basePath: string,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') return methodNotAllowed('POST')
  const runId = routeParameters(request, basePath, ['commands'])?.runId
  if (runId === undefined || options.commands === undefined) return notFound()
  let identity: ScopeIdentity<P>
  try {
    const authenticated = await options.scopeProvider.authenticate(request)
    if (!validIdentity(authenticated)) return unauthorized(options)
    identity = authenticated
  } catch (error) {
    return unexpected(error, request, options, 'command', runId)
  }
  const requiredScopes = options.commands.scopes ?? [`${options.id ?? options.flow.name}:command`]
  try {
    if (!(await authorize(options, identity, request, 'command', runId, requiredScopes))) {
      return forbidden(requiredScopes)
    }
  } catch (error) {
    return unexpected(error, request, options, 'command', runId)
  }
  if (!isJson(request.headers.get('content-type'))) {
    return json(
      415,
      errorBody('API_UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json'),
    )
  }
  const maxBodyBytes = options.commands.maxBodyBytes ?? DEFAULT_COMMAND_BODY_BYTES
  const body = await readBody(request, maxBodyBytes)
  if (body instanceof Response) return body
  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return json(400, errorBody('API_INVALID_JSON', 'request body is not valid JSON'))
  }
  const parsed = parseCommand(options.flow, input)
  if (!parsed.ok) {
    return json(400, {
      ...errorBody('API_INVALID_COMMAND', 'request body is not a command declared by this flow'),
      issues: parsed.issues,
    })
  }
  const context: RunAPICommandContext<F, P> = {
    ...resolveContext(request, runId, identity),
    command: parsed.value,
  }
  try {
    const run = await options.resolveRun(context)
    if (run === null || run === undefined) return notFound()
    if (!(await options.commands.allow({ ...context, run }))) {
      return json(
        403,
        errorBody('API_COMMAND_NOT_ALLOWED', 'the API command policy rejected this command'),
      )
    }
    const result = await run.dispatch(parsed.value)
    if (!result.ok) {
      return json(result.issues === undefined ? 409 : 422, result)
    }
    return json(200, { ok: true, result })
  } catch (error) {
    return unexpected(error, request, options, 'command', runId)
  }
}

async function authenticate<F extends AnyFlow, S, P>(
  request: Request,
  options: RunAPIOptions<F, S, P>,
  operation: 'run:read' | 'step:read',
  runId: string,
  requiredScopes: readonly string[],
): Promise<ScopeIdentity<P> | Response> {
  try {
    const identity = await options.scopeProvider.authenticate(request)
    if (!validIdentity(identity)) return unauthorized(options)
    return (await authorize(options, identity, request, operation, runId, requiredScopes))
      ? identity
      : forbidden(requiredScopes)
  } catch (error) {
    return unexpected(error, request, options, operation, runId)
  }
}

async function authorize<F extends AnyFlow, S, P>(
  options: RunAPIOptions<F, S, P>,
  identity: ScopeIdentity<P>,
  request: Request,
  operation: 'command' | 'run:read' | 'step:read',
  runId: string,
  requiredScopes: readonly string[],
): Promise<boolean> {
  validateScopes(requiredScopes)
  if (options.scopeProvider.authorize !== undefined) {
    return options.scopeProvider.authorize({
      request,
      identity,
      requiredScopes,
      operation,
      runId,
    })
  }
  return requiredScopes.every((scope) => identity.scopes.includes(scope))
}

function resolveContext<P>(
  request: Request,
  runId: string,
  identity: ScopeIdentity<P>,
): RunAPIResolveContext<P> {
  return {
    request,
    runId,
    tenantId: identity.tenantId,
    principal: identity.principal,
    scopes: identity.scopes,
  }
}

async function readBody(request: Request, maxBodyBytes: number): Promise<string | Response> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBodyBytes) return bodyTooLarge()
  let body: string
  try {
    body = await request.text()
  } catch {
    return json(400, errorBody('API_BODY_UNREADABLE', 'request body could not be read'))
  }
  return new TextEncoder().encode(body).byteLength > maxBodyBytes ? bodyTooLarge() : body
}

function bodyTooLarge(): Response {
  return json(413, errorBody('API_BODY_TOO_LARGE', 'request body exceeds its size limit'))
}

function defaultStepProjection(projected: unknown, rawStep: unknown): unknown {
  if (isRecord(projected) && isRecord(projected.steps)) {
    const step = isRecord(rawStep) && typeof rawStep.id === 'string' ? rawStep.id : undefined
    if (step !== undefined && Object.hasOwn(projected.steps, step)) return projected.steps[step]
  }
  if (!isRecord(rawStep)) return undefined
  return {
    id: rawStep.id,
    kind: rawStep.kind,
    status: rawStep.status,
    attempt: rawStep.attempt,
  }
}

function routeParameters(
  request: Request,
  basePath: string,
  suffix: readonly string[],
): { readonly runId: string; readonly values: Readonly<Record<string, string>> } | undefined {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return undefined
  }
  const base = basePath.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (actual.length !== base.length + 1 + suffix.length) return undefined
  if (!base.every((segment, index) => actual[index] === segment)) return undefined
  const encodedRunId = actual[base.length]
  if (encodedRunId === undefined) return undefined
  const runId = decodeSegment(encodedRunId)
  if (runId === undefined || runId.length === 0) return undefined
  const values: Record<string, string> = {}
  for (let index = 0; index < suffix.length; index++) {
    const expected = suffix[index]
    const encoded = actual[base.length + 1 + index]
    if (expected === undefined || encoded === undefined) return undefined
    if (expected.startsWith(':')) {
      const value = decodeSegment(encoded)
      if (value === undefined || value.length === 0) return undefined
      values[expected.slice(1)] = value
    } else if (encoded !== expected) return undefined
  }
  return { runId, values }
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function validIdentity<P>(identity: ScopeIdentity<P> | null): identity is ScopeIdentity<P> {
  return (
    identity !== null &&
    typeof identity === 'object' &&
    typeof identity.tenantId === 'string' &&
    identity.tenantId.length > 0 &&
    Object.hasOwn(identity, 'principal') &&
    Array.isArray(identity.scopes) &&
    identity.scopes.every((scope) => typeof scope === 'string' && scope.length > 0)
  )
}

function unauthorized<F extends AnyFlow, S, P>(options: RunAPIOptions<F, S, P>): Response {
  return json(401, errorBody('API_UNAUTHENTICATED', 'authentication failed'), {
    'www-authenticate': options.scopeProvider.documentation.challenge ?? 'Bearer',
  })
}

function forbidden(requiredScopes: readonly string[]): Response {
  return json(403, {
    ...errorBody('API_INSUFFICIENT_SCOPE', 'the caller lacks a required scope'),
    requiredScopes,
  })
}

function notFound(): Response {
  return json(404, errorBody('API_NOT_FOUND', 'the requested run or step was not found'))
}

function methodNotAllowed(method: 'GET' | 'POST'): Response {
  return json(405, errorBody('API_METHOD_NOT_ALLOWED', `this resource requires ${method}`), {
    allow: method,
  })
}

async function unexpected<F extends AnyFlow, S, P>(
  error: unknown,
  request: Request,
  options: RunAPIOptions<F, S, P>,
  operation: 'command' | 'run:read' | 'step:read',
  runId?: string,
): Promise<Response> {
  try {
    await options.onError?.(error, {
      request,
      operation,
      ...(runId === undefined ? {} : { runId }),
    })
  } catch {
    // Error observers cannot replace the stable API response.
  }
  return json(500, errorBody('API_INTERNAL_ERROR', 'the OpenWizard API request failed'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJson(contentType: string | null): boolean {
  if (contentType === null) return false
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

function json(status: number, body: object, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function errorBody(code: string, message: string): Readonly<Record<string, unknown>> {
  return { ok: false, code, message }
}

function scopes(value: readonly string[] | undefined, fallback: string): readonly string[] {
  const result = value ?? [fallback]
  validateScopes(result)
  return result
}

function validateScopes(values: readonly string[]): void {
  if (values.some((scope) => typeof scope !== 'string' || scope.length === 0)) {
    throw new TypeError('required scopes must be non-empty strings')
  }
}

function scopeDescriptions(
  id: string,
  uses: readonly { readonly scopes: readonly string[]; readonly use: string }[],
): Readonly<Record<string, string>> {
  const byScope = new Map<string, string[]>()
  for (const entry of uses) {
    for (const scope of entry.scopes) {
      const current = byScope.get(scope) ?? []
      if (!current.includes(entry.use)) current.push(entry.use)
      byScope.set(scope, current)
    }
  }
  return Object.fromEntries(
    [...byScope].map(([scope, entries]) => [
      scope,
      `Required for ${joinList(entries)} in the '${id}' API.`,
    ]),
  )
}

function inheritOAuthScopes(
  securityScheme: Readonly<Record<string, unknown>>,
  inherited: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  if (securityScheme.type !== 'oauth2' || !isRecord(securityScheme.flows)) return securityScheme

  const flows = Object.fromEntries(
    Object.entries(securityScheme.flows).map(([name, value]) => {
      if (!isRecord(value)) return [name, value]
      const declared = isRecord(value.scopes) ? value.scopes : {}
      return [name, { ...value, scopes: { ...inherited, ...declared } }]
    }),
  )
  return { ...securityScheme, flows }
}

function joinList(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? 'generated operations'
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function validateReadSteps<F extends AnyFlow>(
  available: readonly StepId<F>[],
  selected: readonly StepId<F>[],
): void {
  const seen = new Set<string>()
  for (const step of selected) {
    if (!available.includes(step)) throw new TypeError(`readSteps contains unknown step '${step}'`)
    if (seen.has(step)) throw new TypeError(`readSteps contains duplicate step '${step}'`)
    seen.add(step)
  }
}

function validateMaxBody(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError('commands.maxBodyBytes must be a positive safe integer')
  }
}

function requireProvider<F extends AnyFlow, S, P>(options: RunAPIOptions<F, S, P>): void {
  const documentation = options.scopeProvider.documentation
  requireNonEmpty(documentation.schemeName, 'scope-provider scheme name')
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(documentation.schemeName)) {
    throw new TypeError('scope-provider scheme name must be an OpenAPI component name')
  }
  if (typeof documentation.securityScheme !== 'object' || documentation.securityScheme === null) {
    throw new TypeError('scope-provider securityScheme must be an OpenAPI object')
  }
  if (typeof documentation.securityScheme.type !== 'string') {
    throw new TypeError('scope-provider securityScheme must declare its OpenAPI type')
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`)
}

function normalizeBasePath(path: string): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes(':')) {
    throw new TypeError(
      'run API basePath must be an absolute pathname without parameters, query, or hash',
    )
  }
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (normalized === '/') throw new TypeError('run API basePath must contain at least one segment')
  return normalized
}

function toOpenAPIPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}
