/**
 * Nitro route and OpenAPI generation for OpenWizard webhook and REST resources.
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { NitroConfig, NitroEventHandler, NitroOpenAPIConfig } from 'nitro/types'
import type { AnyHTTPResource } from './http'
import type { WizardHTTP } from './http-options'
import type { AnyWebhookResource } from './types'

/** Options for generated Nitro HTTP handlers and API documentation. @public */
export interface NitroAPIOptions {
  readonly resources: readonly AnyHTTPResource[]
  /** Module that exports the same resource collection passed to `resources`. */
  readonly resourceModule: string | URL
  /** Named module export containing the collection. Defaults to `resources`. */
  readonly exportName?: string
  /** Nitro OpenAPI overrides. Pass `false` to disable generated API docs. */
  readonly openAPI?: false | NitroOpenAPIConfig
  /** Generated handler cache. Defaults to `.nitro/openwizard-api`. */
  readonly generatedDir?: string
}

/** Options for generated Nitro webhook handlers and API documentation. @public */
export interface NitroWebhookOptions {
  readonly resources: readonly AnyWebhookResource[]
  /** Module that exports the same resource collection passed to `resources`. */
  readonly resourceModule: string | URL
  /** Named module export containing the collection. Defaults to `webhooks`. */
  readonly exportName?: string
  /** Nitro OpenAPI overrides. Pass `false` to disable generated API docs. */
  readonly openAPI?: false | NitroOpenAPIConfig
  /** Generated handler cache. Defaults to `.nitro/openwizard-webhooks`. */
  readonly generatedDir?: string
}

/** Options for mounting generated OpenWizard HTTP routes in Nitro. @public */
export interface NitroOptions
  extends Omit<NitroAPIOptions, 'resources' | 'resourceModule' | 'exportName'> {
  /** Registry returned by `createHTTP`. */
  readonly http: WizardHTTP
  /** Module that exports `http`, normally `new URL('./server/http.ts', import.meta.url)`. */
  readonly source: string | URL
}

/**
 * Add generated POST routes and OpenAPI operations for a collection of webhook resources.
 * @public
 */
export function withNitroWebhooks(config: NitroConfig, options: NitroWebhookOptions): NitroConfig {
  return configureNitro(config, options, {
    exportName: 'webhooks',
    generatedDir: '.nitro/openwizard-webhooks',
    title: 'OpenWizard webhook API',
    description: 'Signed Standard Webhooks endpoints mapped to OpenWizard events.',
  })
}

/** Add generated Nitro routes and OpenAPI operations for mixed OpenWizard HTTP resources. @public */
export function withNitroAPI(config: NitroConfig, options: NitroAPIOptions): NitroConfig {
  return configureNitro(config, options, {
    exportName: 'resources',
    generatedDir: '.nitro/openwizard-api',
    title: 'OpenWizard HTTP API',
    description: 'Authenticated run APIs, signed receivers, and outbound webhook subscriptions.',
  })
}

/** Mount generated OpenWizard routes and their OpenAPI document in Nitro. @public */
export function withNitro(config: NitroConfig, options: NitroOptions): NitroConfig {
  const { http, source, ...nitro } = options
  return configureNitro(
    config,
    { ...nitro, resources: http.resources, resourceModule: source, exportName: 'http' },
    {
      exportName: 'http',
      generatedDir: '.nitro/openwizard-http',
      title: 'OpenWizard HTTP API',
      description: 'Auto-generated run APIs, signed receivers, and outbound webhook subscriptions.',
    },
  )
}

function configureNitro(
  config: NitroConfig,
  options: NitroAPIOptions,
  defaults: {
    readonly exportName: string
    readonly generatedDir: string
    readonly title: string
    readonly description: string
  },
): NitroConfig {
  validateResources(config, options.resources)
  if (options.openAPI !== false && config.experimental?.openAPI === true) {
    throw new TypeError(
      'the OpenWizard Nitro generator owns its OpenAPI routes; disable Nitro experimental.openAPI to avoid duplicate documentation routes',
    )
  }

  const rootDir = resolve(config.rootDir ?? process.cwd())
  const sourceURL =
    options.resourceModule instanceof URL
      ? fileModuleURL(options.resourceModule)
      : pathToFileURL(
          isAbsolute(options.resourceModule)
            ? options.resourceModule
            : resolve(rootDir, options.resourceModule),
        ).href
  const exportName = options.exportName ?? defaults.exportName
  const generatedDir = resolve(rootDir, options.generatedDir ?? defaults.generatedDir)
  mkdirSync(generatedDir, { recursive: true })

  const generatedHandlers: NitroEventHandler[] = options.resources.map((resource) => {
    const source = handlerSource(sourceURL, exportName, resource)
    const handler = writeGenerated(generatedDir, sourceURL, exportName, source)
    return {
      route: resource.path,
      method: resource.method,
      handler,
    }
  })

  const openAPI =
    options.openAPI === false
      ? undefined
      : mergeOpenAPI(config.openAPI, options.openAPI ?? {}, defaults)
  const documentationHandlers =
    openAPI === undefined
      ? []
      : createDocumentationHandlers(config, generatedDir, openAPI, options.resources)
  const shouldPrerender = openAPI?.production === 'prerender'
  const documentationRoutes = documentationHandlers.map((handler) => handler.route)

  return {
    ...config,
    ...(openAPI === undefined ? {} : { openAPI }),
    ...(shouldPrerender
      ? {
          prerender: {
            ...config.prerender,
            routes: [...new Set([...(config.prerender?.routes ?? []), ...documentationRoutes])],
          },
        }
      : {}),
    handlers: [...(config.handlers ?? []), ...generatedHandlers, ...documentationHandlers],
  }
}

function validateResources(config: NitroConfig, resources: readonly AnyHTTPResource[]): void {
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const resource of resources) {
    if (resource.id.length === 0) throw new TypeError('HTTP resource id must not be empty')
    requireRoute(resource.path, 'HTTP resource path')
    if (resource.openAPIPath !== undefined) {
      requireRoute(resource.openAPIPath, 'HTTP resource OpenAPI path')
    }
    if (ids.has(resource.id)) throw new TypeError(`duplicate HTTP resource id '${resource.id}'`)
    const route = `${resource.method} ${resource.path}`
    if (routes.has(route)) throw new TypeError(`duplicate HTTP resource route '${route}'`)
    if (
      config.handlers?.some(
        (handler) =>
          handler.route === resource.path &&
          (handler.method === undefined || handler.method.toUpperCase() === resource.method),
      ) === true
    ) {
      throw new TypeError(`Nitro already has a handler for '${route}'`)
    }
    ids.add(resource.id)
    routes.add(route)
  }
}

function handlerSource(sourceURL: string, exportName: string, resource: AnyHTTPResource): string {
  return `import { defineHandler } from 'nitro/h3'
import * as source from ${JSON.stringify(sourceURL)}

const exported = source[${JSON.stringify(exportName)}]
const resources = Array.isArray(exported) ? exported : exported?.resources
const resource = Array.isArray(resources)
  ? resources.find((candidate) => candidate?.id === ${JSON.stringify(resource.id)})
  : undefined

if (resource === undefined) {
  throw new Error(${JSON.stringify(
    `generated HTTP handler could not find resource '${resource.id}' in export '${exportName}'`,
  )})
}

export default defineHandler((event) => resource.handle(event.req))
`
}

function createDocumentationHandlers(
  config: NitroConfig,
  generatedDir: string,
  openAPI: NitroOpenAPIConfig,
  resources: readonly AnyHTTPResource[],
): NitroEventHandler[] {
  const handlers: NitroEventHandler[] = []
  const generatedRoutes = new Set<string>()
  const env = documentationEnv(openAPI)
  const route = openAPI.route ?? '/_openapi.json'
  requireAvailableRoute(config, resources, 'GET', route)
  reserveDocumentationRoute(generatedRoutes, route)
  handlers.push({
    route,
    method: 'GET',
    env,
    handler: writeGenerated(generatedDir, route, 'openapi', openAPISource(openAPI, resources)),
  })

  if (openAPI.ui?.scalar !== false) {
    const scalarRoute = openAPI.ui?.scalar?.route ?? '/_scalar'
    requireAvailableRoute(config, resources, 'GET', scalarRoute)
    reserveDocumentationRoute(generatedRoutes, scalarRoute)
    handlers.push({
      route: scalarRoute,
      method: 'GET',
      env,
      handler: writeGenerated(
        generatedDir,
        scalarRoute,
        'scalar',
        htmlSource(scalarHTML(openAPI, route)),
      ),
    })
  }

  if (openAPI.ui?.swagger !== false) {
    const swaggerRoute = openAPI.ui?.swagger?.route ?? '/_swagger'
    requireAvailableRoute(config, resources, 'GET', swaggerRoute)
    reserveDocumentationRoute(generatedRoutes, swaggerRoute)
    handlers.push({
      route: swaggerRoute,
      method: 'GET',
      env,
      handler: writeGenerated(
        generatedDir,
        swaggerRoute,
        'swagger',
        htmlSource(swaggerHTML(openAPI, route)),
      ),
    })
  }
  return handlers
}

function reserveDocumentationRoute(routes: Set<string>, route: string): void {
  if (routes.has(route)) throw new TypeError(`duplicate generated documentation route '${route}'`)
  routes.add(route)
}

function openAPISource(openAPI: NitroOpenAPIConfig, resources: readonly AnyHTTPResource[]): string {
  const paths: Record<string, Record<string, object>> = {}
  for (const resource of resources) {
    const path = resource.openAPIPath ?? toOpenAPIPath(resource.path)
    const methods = paths[path] ?? {}
    const method = resource.method.toLowerCase()
    if (methods[method] !== undefined) {
      throw new TypeError(`duplicate OpenAPI operation '${resource.method} ${path}'`)
    }
    methods[method] = resource.openAPI
    paths[path] = methods
  }
  const securitySchemes: Record<string, Readonly<Record<string, unknown>>> = {}
  for (const resource of resources) {
    for (const [name, scheme] of Object.entries(
      resource.openAPIComponents?.securitySchemes ?? {},
    )) {
      const existing = securitySchemes[name]
      if (existing !== undefined) {
        const merged = mergeSecuritySchemes(existing, scheme)
        if (merged === undefined) {
          throw new TypeError(`OpenAPI security scheme '${name}' has conflicting definitions`)
        }
        securitySchemes[name] = merged
      } else {
        securitySchemes[name] = scheme
      }
    }
  }
  const document = {
    openapi: '3.1.0',
    info: {
      title: openAPI.meta?.title ?? 'OpenWizard HTTP API',
      version: openAPI.meta?.version ?? '1.0.0',
      ...(openAPI.meta?.description === undefined ? {} : { description: openAPI.meta.description }),
    },
    paths,
    ...(Object.keys(securitySchemes).length === 0 ? {} : { components: { securitySchemes } }),
  }
  return `import { defineHandler } from 'nitro/h3'

const document = ${JSON.stringify(document, null, 2)}

export default defineHandler(() => document)
`
}

function mergeSecuritySchemes(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  if (JSON.stringify(left) === JSON.stringify(right)) return left
  if (
    left.type !== 'oauth2' ||
    right.type !== 'oauth2' ||
    !isRecord(left.flows) ||
    !isRecord(right.flows)
  ) {
    return undefined
  }
  const { flows: _leftFlows, ...leftBase } = left
  const { flows: _rightFlows, ...rightBase } = right
  if (JSON.stringify(leftBase) !== JSON.stringify(rightBase)) return undefined

  const flows: Record<string, unknown> = {}
  for (const name of new Set([...Object.keys(left.flows), ...Object.keys(right.flows)])) {
    const leftFlow = left.flows[name]
    const rightFlow = right.flows[name]
    if (leftFlow === undefined) {
      flows[name] = rightFlow
      continue
    }
    if (rightFlow === undefined) {
      flows[name] = leftFlow
      continue
    }
    if (!isRecord(leftFlow) || !isRecord(rightFlow)) return undefined
    const { scopes: _leftScopes, ...leftFlowBase } = leftFlow
    const { scopes: _rightScopes, ...rightFlowBase } = rightFlow
    if (JSON.stringify(leftFlowBase) !== JSON.stringify(rightFlowBase)) return undefined
    if (!isRecord(leftFlow.scopes) || !isRecord(rightFlow.scopes)) return undefined
    flows[name] = {
      ...leftFlowBase,
      scopes: { ...leftFlow.scopes, ...rightFlow.scopes },
    }
  }
  return { ...leftBase, flows }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalarHTML(openAPI: NitroOpenAPIConfig, openAPIRoute: string): string {
  const scalar = openAPI.ui?.scalar
  const config = {
    ...(typeof scalar === 'object' && scalar !== null ? scalar : {}),
    url: openAPIRoute,
    spec: { url: openAPIRoute },
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHTML(openAPI.meta?.description ?? '')}" />
    <title>${escapeHTML(openAPI.meta?.title ?? 'OpenWizard webhook API')}</title>
  </head>
  <body>
    <script id="api-reference" data-configuration="${escapeAttribute(JSON.stringify(config))}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
}

function swaggerHTML(openAPI: NitroOpenAPIConfig, openAPIRoute: string): string {
  const swagger = openAPI.ui?.swagger
  const config =
    typeof swagger === 'object' && swagger !== null
      ? Object.fromEntries(Object.entries(swagger).filter(([key]) => key !== 'route'))
      : {}
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHTML(openAPI.meta?.description ?? '')}" />
    <title>${escapeHTML(openAPI.meta?.title ?? 'OpenWizard webhook API')}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@^5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@^5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => SwaggerUIBundle({
        ...${safeScriptJSON(config)},
        url: ${safeScriptJSON(openAPIRoute)},
        dom_id: '#swagger-ui',
      })
    </script>
  </body>
</html>`
}

function htmlSource(html: string): string {
  return `import { defineHandler } from 'nitro/h3'

const html = ${JSON.stringify(html)}

export default defineHandler(() => new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8' },
}))
`
}

function documentationEnv(openAPI: NitroOpenAPIConfig): NonNullable<NitroEventHandler['env']> {
  if (openAPI.production === 'runtime') return ['dev', 'prod']
  if (openAPI.production === 'prerender') return ['dev', 'prerender']
  return 'dev'
}

function requireAvailableRoute(
  config: NitroConfig,
  resources: readonly AnyHTTPResource[],
  method: 'GET',
  route: string,
): void {
  if (!route.startsWith('/') || route.includes('?') || route.includes('#')) {
    throw new TypeError(`generated documentation route must be an absolute pathname: '${route}'`)
  }
  if (resources.some((resource) => resource.path === route && resource.method === method)) {
    throw new TypeError(`HTTP resource conflicts with generated documentation route '${route}'`)
  }
  if (
    config.handlers?.some(
      (handler) =>
        handler.route === route &&
        (handler.method === undefined || handler.method.toUpperCase() === method),
    ) === true
  ) {
    throw new TypeError(`Nitro already has a handler for '${method} ${route}'`)
  }
}

function mergeOpenAPI(
  existing: NitroOpenAPIConfig | undefined,
  provided: NitroOpenAPIConfig,
  defaults: { readonly title: string; readonly description: string },
): NitroOpenAPIConfig {
  const ui = mergeUI(existing?.ui, provided.ui)
  return {
    ...existing,
    ...provided,
    meta: {
      title: defaults.title,
      description: defaults.description,
      version: '1.0.0',
      ...existing?.meta,
      ...provided.meta,
    },
    ...(ui === undefined ? {} : { ui }),
  }
}

function mergeUI(
  existing: NitroOpenAPIConfig['ui'] | undefined,
  provided: NitroOpenAPIConfig['ui'] | undefined,
): NitroOpenAPIConfig['ui'] | undefined {
  if (existing === undefined && provided === undefined) return undefined
  const scalar = mergeUIEntry(existing?.scalar, provided?.scalar)
  const swagger = mergeUIEntry(existing?.swagger, provided?.swagger)
  return {
    ...(scalar === undefined ? {} : { scalar }),
    ...(swagger === undefined ? {} : { swagger }),
  }
}

function mergeUIEntry<T extends false | Readonly<Record<string, unknown>>>(
  existing: T | undefined,
  provided: T | undefined,
): T | undefined {
  if (provided === false) return false as T
  if (provided !== undefined) {
    if (existing === undefined || existing === false) return provided
    return { ...existing, ...provided } as T
  }
  return existing
}

function writeIfChanged(file: string, source: string): void {
  if (existsSync(file) && readFileSync(file, 'utf8') === source) return
  writeFileSync(file, source)
}

function fileModuleURL(url: URL): string {
  if (url.protocol !== 'file:') {
    throw new TypeError(`resourceModule URL must use the file protocol, received '${url.protocol}'`)
  }
  return url.href
}

function writeGenerated(generatedDir: string, scope: string, name: string, source: string): string {
  const file = resolve(generatedDir, `${hash(`${scope}\0${name}\0${source}`)}.mjs`)
  writeIfChanged(file, source)
  return file
}

function safeScriptJSON(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHTML(value)
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

function toOpenAPIPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

function requireRoute(path: string, label: string): void {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError(`${label} must be an absolute pathname without a query or hash`)
  }
}
