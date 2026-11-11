/**
 * `@openwizard/http/nitro`: mount a `createHTTP` / `combineHTTP` handler and its OpenAPI
 * document in Nitro.
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { NitroConfig, NitroEventHandler, NitroOpenAPIConfig } from 'nitro/types'
import type { HTTPHandler } from './http'
import { htmlModule, scalarHTML, swaggerHTML } from './nitro-docs'

/** Options of `withNitro`. @public */
export interface NitroOptions {
  /** The handler returned by `createHTTP` or `combineHTTP`. */
  readonly http: HTTPHandler
  /** Module that exports `http`, normally `new URL('./server/http.ts', import.meta.url)`. */
  readonly source: string | URL
  /** Named export of `http` in `source`. Defaults to `http`. */
  readonly exportName?: string
  /** Document and UI routes; `meta` titles the document. Pass `false` to serve no documentation. */
  readonly openAPI?: false | NitroOpenAPIConfig
  /** Generated handler cache. Defaults to `.nitro/openwizard-http`. */
  readonly generatedDir?: string
}

/**
 * Add one Nitro route per generated path (every method goes to `http.fetch`, which answers
 * 405s and CORS preflights itself) plus the OpenAPI document, Scalar and Swagger routes.
 * @public
 */
export function withNitro(config: NitroConfig, options: NitroOptions): NitroConfig {
  if (options.openAPI !== false && config.experimental?.openAPI === true) {
    throw new TypeError(
      'withNitro serves its own OpenAPI routes; disable Nitro experimental.openAPI to avoid duplicate documentation',
    )
  }
  const rootDir = resolve(config.rootDir ?? process.cwd())
  const generatedDir = resolve(rootDir, options.generatedDir ?? '.nitro/openwizard-http')
  mkdirSync(generatedDir, { recursive: true })
  const routes = [...new Set(options.http.resources.map((resource) => resource.path))]
  for (const route of routes) requireFree(config, route)
  const handler = writeModule(
    generatedDir,
    handlerModule(sourceURL(rootDir, options.source), options.exportName ?? 'http'),
  )
  const openAPI =
    options.openAPI === false ? undefined : mergeOpenAPI(config.openAPI, options.openAPI ?? {})
  const documentation =
    openAPI === undefined
      ? []
      : documentationHandlers(config, generatedDir, openAPI, options.http, routes)
  return {
    ...config,
    ...(openAPI === undefined ? {} : { openAPI }),
    ...(openAPI?.production === 'prerender'
      ? {
          prerender: {
            ...config.prerender,
            routes: [
              ...new Set([
                ...(config.prerender?.routes ?? []),
                ...documentation.map((entry) => entry.route),
              ]),
            ],
          },
        }
      : {}),
    handlers: [
      ...(config.handlers ?? []),
      ...routes.map((route) => ({ route, handler })),
      ...documentation,
    ],
  }
}

function handlerModule(source: string, exportName: string): string {
  return `import { defineHandler } from 'nitro/h3'
import * as source from ${JSON.stringify(source)}

const http = source[${JSON.stringify(exportName)}]
if (typeof http?.fetch !== 'function') {
  throw new Error(${JSON.stringify(`export '${exportName}' of ${source} is not an OpenWizard HTTP handler`)})
}

export default defineHandler((event) => http.fetch(event.req))
`
}

function documentationHandlers(
  config: NitroConfig,
  generatedDir: string,
  openAPI: NitroOpenAPIConfig,
  http: HTTPHandler,
  routes: readonly string[],
): NitroEventHandler[] {
  const env: NonNullable<NitroEventHandler['env']> =
    openAPI.production === 'runtime'
      ? ['dev', 'prod']
      : openAPI.production === 'prerender'
        ? ['dev', 'prerender']
        : 'dev'
  const documentRoute = openAPI.route ?? '/_openapi.json'
  const document = http.openAPI({
    title: openAPI.meta?.title ?? 'OpenWizard HTTP API',
    version: openAPI.meta?.version ?? '1.0.0',
    ...(openAPI.meta?.description === undefined ? {} : { description: openAPI.meta.description }),
  })
  const pages = [
    {
      route: documentRoute,
      module: `import { defineHandler } from 'nitro/h3'

const document = ${JSON.stringify(document, null, 2)}

export default defineHandler(() => document)
`,
    },
  ]
  if (openAPI.ui?.scalar !== false) {
    const route = openAPI.ui?.scalar?.route ?? '/_scalar'
    pages.push({ route, module: htmlModule(scalarHTML(openAPI, documentRoute)) })
  }
  if (openAPI.ui?.swagger !== false) {
    const route = openAPI.ui?.swagger?.route ?? '/_swagger'
    pages.push({ route, module: htmlModule(swaggerHTML(openAPI, documentRoute)) })
  }
  const seen = new Set<string>(routes)
  return pages.map(({ route, module }) => {
    if (seen.has(route)) throw new TypeError(`the documentation route '${route}' is already taken`)
    seen.add(route)
    requireFree(config, route)
    return { route, method: 'GET', env, handler: writeModule(generatedDir, module) }
  })
}

function mergeOpenAPI(
  existing: NitroOpenAPIConfig | undefined,
  provided: NitroOpenAPIConfig,
): NitroOpenAPIConfig {
  const scalar = provided.ui?.scalar ?? existing?.ui?.scalar
  const swagger = provided.ui?.swagger ?? existing?.ui?.swagger
  return {
    ...existing,
    ...provided,
    meta: { ...existing?.meta, ...provided.meta },
    ui: {
      ...(scalar === undefined ? {} : { scalar }),
      ...(swagger === undefined ? {} : { swagger }),
    },
  }
}

function requireFree(config: NitroConfig, route: string): void {
  if (!route.startsWith('/') || route.includes('?') || route.includes('#')) {
    throw new TypeError(`Nitro route must be an absolute pathname: '${route}'`)
  }
  if (config.handlers?.some((handler) => handler.route === route) === true) {
    throw new TypeError(`Nitro already has a handler for '${route}'`)
  }
}

function sourceURL(rootDir: string, source: string | URL): string {
  if (source instanceof URL) {
    if (source.protocol !== 'file:')
      throw new TypeError(`source must be a file URL, received '${source.protocol}'`)
    return source.href
  }
  return pathToFileURL(isAbsolute(source) ? source : resolve(rootDir, source)).href
}

/** Write `source` to a content-addressed module (unchanged files are not rewritten). */
function writeModule(generatedDir: string, source: string): string {
  const file = resolve(generatedDir, `${hash(source)}.mjs`)
  if (!existsSync(file) || readFileSync(file, 'utf8') !== source) writeFileSync(file, source)
  return file
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}
