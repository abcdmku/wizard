import type { AnyHTTPResource, HTTPSource } from './http'
import { isRecord } from './json-schema'
import { toOpenAPIPath } from './naming'
import { COMMON_SCHEMAS } from './openapi-common'
import type {
  JSONSchema,
  OpenAPIContribution,
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIOperation,
  OpenAPITag,
} from './openapi-types'

/**
 * The components of several sources as one contribution. Equal definitions under one name
 * merge; OAuth schemes that differ only in scopes merge their scopes; any other clash throws.
 */
export function mergeContributions(sources: readonly HTTPSource[]): OpenAPIContribution {
  const schemas: Record<string, JSONSchema> = {}
  const securitySchemes: Record<string, JSONSchema> = {}
  const webhooks: Record<string, { readonly post: OpenAPIOperation }> = {}
  const tags = new Map<string, OpenAPITag>()
  for (const { openAPIComponents: part } of sources) {
    for (const [name, schema] of Object.entries(part.schemas)) {
      schemas[name] = same(schemas[name], schema, `component schema '${name}'`)
    }
    for (const [name, scheme] of Object.entries(part.securitySchemes)) {
      const existing = securitySchemes[name]
      const merged = existing === undefined ? scheme : mergeSecuritySchemes(existing, scheme)
      if (merged === undefined)
        throw new TypeError(`security scheme '${name}' has two different definitions`)
      securitySchemes[name] = merged
    }
    for (const [name, webhook] of Object.entries(part.webhooks)) {
      webhooks[name] = same(webhooks[name], webhook, `webhook '${name}'`)
    }
    for (const tag of part.tags)
      tags.set(tag.name, same(tags.get(tag.name), tag, `tag '${tag.name}'`))
  }
  for (const [name, schema] of Object.entries(COMMON_SCHEMAS)) {
    if (schemas[name] !== undefined) same(schema, schemas[name], `component schema '${name}'`)
  }
  return { schemas, securitySchemes, webhooks, tags: [...tags.values()] }
}

/**
 * The OpenAPI 3.1 document of `resources` (routes without `openAPI` are left out) with the
 * shared schemas they reference. Throws on a duplicate operation id or a dangling `$ref`.
 */
export function createOpenAPIDocument(
  info: OpenAPIInfo,
  resources: readonly AnyHTTPResource[],
  components: OpenAPIContribution,
): OpenAPIDocument {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {}
  const operationIds = new Set<string>()
  const claim = (operation: OpenAPIOperation) => {
    if (operationIds.has(operation.operationId)) {
      throw new TypeError(`duplicate OpenAPI operationId '${operation.operationId}'`)
    }
    operationIds.add(operation.operationId)
  }
  for (const resource of resources) {
    if (resource.openAPI === undefined) continue
    claim(resource.openAPI)
    const path = toOpenAPIPath(resource.path)
    paths[path] = { ...paths[path], [resource.method.toLowerCase()]: resource.openAPI }
  }
  for (const webhook of Object.values(components.webhooks)) claim(webhook.post)
  const schemas = withCommonSchemas(components.schemas, [paths, components.webhooks])
  const dangling = [...refsOf([paths, components.webhooks, schemas])].find(
    (name) => schemas[name] === undefined,
  )
  if (dangling !== undefined) throw new TypeError(`OpenAPI $ref to missing schema '${dangling}'`)
  return {
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      ...(info.description === undefined ? {} : { description: info.description }),
    },
    ...(info.servers === undefined ? {} : { servers: info.servers }),
    tags: components.tags,
    paths,
    ...(Object.keys(components.webhooks).length === 0 ? {} : { webhooks: components.webhooks }),
    components: {
      schemas,
      ...(Object.keys(components.securitySchemes).length === 0
        ? {}
        : { securitySchemes: components.securitySchemes }),
    },
  }
}

/** `schemas` plus every shared schema reachable from `roots` or from `schemas`. */
function withCommonSchemas(
  schemas: { readonly [name: string]: JSONSchema },
  roots: readonly unknown[],
): { readonly [name: string]: JSONSchema } {
  const result: Record<string, JSONSchema> = { ...schemas }
  let pending = [...refsOf([...roots, schemas])]
  while (pending.length > 0) {
    const added: JSONSchema[] = []
    for (const name of pending) {
      const common = COMMON_SCHEMAS[name]
      if (common !== undefined && result[name] === undefined) {
        result[name] = common
        added.push(common)
      }
    }
    pending = [...refsOf(added)]
  }
  return result
}

/** Component names referenced by `#/components/schemas/<name>` anywhere in `value`. */
function refsOf(value: unknown): ReadonlySet<string> {
  const names = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit)
    else if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (
          key === '$ref' &&
          typeof child === 'string' &&
          child.startsWith('#/components/schemas/')
        ) {
          names.add(child.slice('#/components/schemas/'.length))
        } else visit(child)
      }
    }
  }
  visit(value)
  return names
}

function same<T>(existing: T | undefined, next: T, label: string): T {
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(next)) {
    throw new TypeError(`OpenAPI ${label} has two different definitions`)
  }
  return next
}

/** Two OAuth schemes that differ only in their scope lists, with the scopes united. */
function mergeSecuritySchemes(left: JSONSchema, right: JSONSchema): JSONSchema | undefined {
  if (JSON.stringify(left) === JSON.stringify(right)) return left
  if (left.type !== 'oauth2' || right.type !== 'oauth2') return undefined
  if (!isRecord(left.flows) || !isRecord(right.flows)) return undefined
  const { flows: leftFlows, ...leftBase } = left
  const { flows: rightFlows, ...rightBase } = right
  if (JSON.stringify(leftBase) !== JSON.stringify(rightBase)) return undefined
  const flows: Record<string, unknown> = {}
  for (const name of new Set([...Object.keys(leftFlows), ...Object.keys(rightFlows)])) {
    const leftFlow = leftFlows[name]
    const rightFlow = rightFlows[name]
    if (leftFlow === undefined || rightFlow === undefined) {
      flows[name] = leftFlow ?? rightFlow
      continue
    }
    if (!isRecord(leftFlow) || !isRecord(rightFlow)) return undefined
    const { scopes: leftScopes, ...leftRest } = leftFlow
    const { scopes: rightScopes, ...rightRest } = rightFlow
    if (JSON.stringify(leftRest) !== JSON.stringify(rightRest)) return undefined
    if (!isRecord(leftScopes) || !isRecord(rightScopes)) return undefined
    flows[name] = { ...leftRest, scopes: { ...leftScopes, ...rightScopes } }
  }
  return { ...leftBase, flows }
}
