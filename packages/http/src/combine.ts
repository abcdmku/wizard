import { type CORSOptions, validateCORS } from './cors'
import type { HTTPHandler, HTTPSource } from './http'
import { createOpenAPIDocument, mergeContributions } from './openapi-document'
import { collectResources, createFetchHandler } from './router'

/** Options of `combineHTTP`. @public */
export interface CombineHTTPOptions {
  /** Cross-origin access for browser clients. Off by default. */
  readonly cors?: CORSOptions
}

/**
 * Serve several sources (`createHTTP` results, `createWebhookSubscriptions`) as one handler with
 * one OpenAPI document. Duplicate routes, resource ids, operation ids and conflicting component
 * definitions throw here, at startup.
 * @public
 */
export function combineHTTP(
  sources: readonly HTTPSource[],
  options: CombineHTTPOptions = {},
): HTTPHandler {
  validateCORS(options.cors)
  const resources = collectResources(sources)
  const openAPIComponents = mergeContributions(sources)
  createOpenAPIDocument({ title: 'check', version: '0' }, resources, openAPIComponents)
  const handler: HTTPHandler = {
    resources,
    openAPIComponents,
    fetch: createFetchHandler(resources, options.cors),
    openAPI: (info) => createOpenAPIDocument(info, resources, openAPIComponents),
  }
  return Object.freeze(handler)
}
