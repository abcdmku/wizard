import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { JSONSchema } from './openapi-types'

/** Named component schemas of one API, deduplicated by name. */
export interface SchemaRegistry {
  readonly schemas: { readonly [name: string]: JSONSchema }
  /**
   * Register `schema` under `name` (hoisting its `$defs` as `<name><Def>` components and
   * dropping its `$schema` dialect) and return a `$ref` to it.
   */
  ref(name: string, schema: JSONSchema): JSONSchema
}

export function createSchemaRegistry(): SchemaRegistry {
  const schemas: Record<string, JSONSchema> = {}
  const add = (name: string, schema: JSONSchema): void => {
    const existing = schemas[name]
    if (existing === undefined) schemas[name] = schema
    else if (JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new TypeError(`OpenAPI component schema '${name}' has two different definitions`)
    }
  }
  return {
    schemas,
    ref(name, schema) {
      const { $defs, $schema: _dialect, ...body } = schema
      const rename = (definition: string) => `${name}${definition.replace(/[^A-Za-z0-9]/g, '')}`
      for (const [definition, value] of Object.entries(isRecord($defs) ? $defs : {})) {
        if (isRecord(value)) add(rename(definition), rewriteRefs(value, name, rename))
      }
      add(name, rewriteRefs(body, name, rename))
      return refTo(name)
    },
  }
}

export function refTo(name: string): JSONSchema {
  return { $ref: `#/components/schemas/${name}` }
}

/** Point local `$defs` and root references at the hoisted component names. */
function rewriteRefs(
  value: JSONSchema,
  root: string,
  rename: (definition: string) => string,
): JSONSchema {
  const rewrite = (child: unknown): unknown =>
    Array.isArray(child)
      ? child.map(rewrite)
      : isRecord(child)
        ? rewriteRefs(child, root, rename)
        : child
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key !== '$ref' || typeof child !== 'string') return [key, rewrite(child)]
      if (child === '#') return [key, `#/components/schemas/${root}`]
      return child.startsWith('#/$defs/')
        ? [key, `#/components/schemas/${rename(child.slice('#/$defs/'.length))}`]
        : [key, child]
    }),
  )
}

/** A draft schema: the same object with every property optional (view drafts are partial). */
export function partialSchema(schema: JSONSchema): JSONSchema {
  const { required: _required, ...rest } = schema
  return rest
}

/** Keep only `keys` of an object schema's properties. */
export function pickProperties(
  schema: JSONSchema | undefined,
  keys: readonly string[],
): JSONSchema {
  const properties = isRecord(schema?.properties) ? schema.properties : {}
  const required = Array.isArray(schema?.required) ? schema.required : []
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((key) => [key, properties[key] ?? {}])),
    required: keys.filter((key) => required.includes(key)),
    additionalProperties: false,
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  if (!('~standard' in value)) return false
  const standard = value['~standard']
  return isRecord(standard) && typeof standard.validate === 'function'
}

/** Standard Schema issues as JSON-safe `{ message, path }` values. */
export function jsonIssues(
  issues: readonly StandardSchemaV1.Issue[],
): readonly { readonly message: string; readonly path?: readonly (string | number)[] }[] {
  return issues.map((issue) => ({
    message: issue.message,
    ...(issue.path === undefined
      ? {}
      : {
          path: issue.path.map((segment) => {
            const key = typeof segment === 'object' ? segment.key : segment
            return typeof key === 'symbol' ? String(key) : key
          }),
        }),
  }))
}
