import type { Schema } from '../wire'

type Loose = {
  readonly type?: unknown
  readonly properties?: Readonly<Record<string, Schema>>
  readonly required?: readonly string[]
  readonly items?: Schema
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly default?: unknown
  readonly anyOf?: readonly Schema[]
  readonly oneOf?: readonly Schema[]
}

/**
 * A value that has the shape of a JSON Schema, for a form to open with: `""` for a string, `0`
 * for a number, the first choice of an enum, and an object with its required properties.
 */
export function exampleOf(schema: Schema | undefined, depth = 0): unknown {
  if (schema === undefined || typeof schema !== 'object' || depth > 6) return {}
  const node = schema as Loose
  if (node.default !== undefined) return node.default
  if (node.const !== undefined) return node.const
  if (node.enum !== undefined && node.enum.length > 0) return node.enum[0]
  const choice = node.anyOf?.[0] ?? node.oneOf?.[0]
  if (choice !== undefined) return exampleOf(choice, depth + 1)
  const type = Array.isArray(node.type) ? node.type.find((item) => item !== 'null') : node.type
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  if (type === 'array') return []
  if (type === 'object' || node.properties !== undefined) {
    const required = new Set(node.required ?? Object.keys(node.properties ?? {}))
    return Object.fromEntries(
      Object.entries(node.properties ?? {})
        .filter(([key]) => required.has(key))
        .map(([key, value]) => [key, exampleOf(value, depth + 1)]),
    )
  }
  return {}
}
