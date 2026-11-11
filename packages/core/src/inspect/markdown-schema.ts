/**
 * JSON Schema summaries for `toMarkdown`: one short type expression, or a table of an object's
 * fields. Reads the common draft 2020-12 keywords and prints anything else as `unknown`.
 * @internal
 */

import type { JSONSchema } from './types'

/** A table of an object schema's fields, or one line for any other schema. */
export function fieldTable(schema: JSONSchema): string[] {
  const properties = record(schema.properties)
  if (properties === undefined || Object.keys(properties).length === 0) {
    return [`\`${describeSchema(schema)}\``]
  }
  const required = new Set(strings(schema.required))
  const fields = Object.entries(properties).map(([name, value]) => {
    const field = record(value)
    return {
      cells: [
        `\`${name}\``,
        `\`${cell(describeSchema(field))}\``,
        required.has(name) ? 'yes' : 'no',
      ],
      description: typeof field?.description === 'string' ? cell(field.description) : '',
    }
  })
  const described = fields.some((field) => field.description !== '')
  const head = ['Field', 'Type', 'Required', ...(described ? ['Description'] : [])]
  const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [
    row(head),
    row(head.map(() => '---')),
    ...fields.map((field) => row(described ? [...field.cells, field.description] : field.cells)),
  ]
}

/** A short type expression such as `string`, `number[]`, `{ id, total? }` or `"a" | "b"`. */
export function describeSchema(schema: JSONSchema | undefined): string {
  if (schema === undefined) return 'unknown'
  if ('const' in schema) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    const options = schema[keyword]
    if (Array.isArray(options)) {
      return options.map((option) => describeSchema(record(option))).join(' | ')
    }
  }
  if (Array.isArray(schema.type)) {
    return schema.type.filter((type) => typeof type === 'string').join(' | ')
  }
  if (schema.type === 'array') return `${wrap(describeSchema(record(schema.items)))}[]`
  if (schema.type === 'object') {
    const properties = record(schema.properties)
    if (properties === undefined) return 'object'
    const required = new Set(strings(schema.required))
    const names = Object.keys(properties).map((name) => (required.has(name) ? name : `${name}?`))
    return names.length === 0 ? '{}' : `{ ${names.join(', ')} }`
  }
  if (typeof schema.type !== 'string') return 'unknown'
  return typeof schema.format === 'string' ? `${schema.type} (${schema.format})` : schema.type
}

function wrap(type: string): string {
  return type.includes(' | ') ? `(${type})` : type
}

function record(value: unknown): JSONSchema | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll(/\s*\n\s*/g, ' ')
}
