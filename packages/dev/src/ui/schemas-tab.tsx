import type { ReactElement, ReactNode } from 'react'
import type { Schema, WizardInfo } from '../wire'
import { JsonView } from './json'
import { Kind, type OutsideKind } from './kind'

interface Loose {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly anyOf?: readonly Loose[]
  readonly oneOf?: readonly Loose[]
  readonly properties?: Readonly<Record<string, Loose>>
  readonly required?: readonly string[]
  readonly items?: Loose
  readonly description?: string
  readonly format?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
  readonly pattern?: string
  readonly default?: unknown
}

interface FieldRow {
  readonly name: string
  readonly depth: number
  readonly type: string
  readonly required: boolean
  readonly notes: readonly string[]
}

/** A JSON Schema type in a few words: `string`, `"a" or "b"`, `list of number`. */
function typeOf(schema: Loose): string {
  if (Array.isArray(schema.enum))
    return schema.enum.map((item) => JSON.stringify(item)).join(' or ')
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  const union = schema.anyOf ?? schema.oneOf
  if (union !== undefined) return union.map(typeOf).join(' or ')
  if (schema.type === 'array')
    return schema.items === undefined ? 'list' : `list of ${typeOf(schema.items)}`
  if (Array.isArray(schema.type)) return schema.type.join(' or ')
  if (typeof schema.type === 'string')
    return schema.type === 'integer' ? 'whole number' : schema.type
  return 'any value'
}

/** The limits a schema sets, in words. */
function notesOf(schema: Loose): readonly string[] {
  const notes: string[] = []
  if (schema.format !== undefined) notes.push(schema.format)
  if (schema.minLength === 1) notes.push('not empty')
  else if (schema.minLength !== undefined) notes.push(`at least ${schema.minLength} characters`)
  if (schema.maxLength !== undefined) notes.push(`at most ${schema.maxLength} characters`)
  if (schema.exclusiveMinimum === 0) notes.push('above 0')
  else if (schema.exclusiveMinimum !== undefined) notes.push(`above ${schema.exclusiveMinimum}`)
  if (schema.minimum !== undefined) notes.push(`at least ${schema.minimum}`)
  if (schema.maximum !== undefined) notes.push(`at most ${schema.maximum}`)
  if (schema.exclusiveMaximum !== undefined) notes.push(`below ${schema.exclusiveMaximum}`)
  if (schema.minItems !== undefined) notes.push(`at least ${schema.minItems} items`)
  if (schema.pattern !== undefined) notes.push(`matches ${schema.pattern}`)
  if (schema.default !== undefined) notes.push(`defaults to ${JSON.stringify(schema.default)}`)
  if (schema.description !== undefined) notes.push(schema.description)
  return notes
}

/** One row per property, and one per nested property under its parent. */
function rowsOf(schema: Loose, prefix = '', depth = 0, rows: FieldRow[] = []): FieldRow[] {
  const required = new Set(schema.required ?? [])
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const nested = property.type === 'object' && property.properties !== undefined
    const item = property.type === 'array' ? property.items : undefined
    rows.push({
      name: `${prefix}${name}`,
      depth,
      type: nested ? 'object' : typeOf(property),
      required: required.has(name),
      notes: notesOf(property),
    })
    if (nested && depth < 3) rowsOf(property, `${prefix}${name}.`, depth + 1, rows)
    else if (item?.properties !== undefined && depth < 3)
      rowsOf(item, `${prefix}${name}[].`, depth + 1, rows)
  }
  return rows
}

/** A schema as a list of fields, with the raw JSON Schema behind a disclosure. */
function SchemaView(props: {
  readonly title: ReactNode
  readonly schema: Schema | undefined
  /** What to say when there is no schema. */
  readonly missing?: string
}): ReactElement {
  const schema = props.schema as Loose | undefined
  const rows = schema === undefined ? [] : rowsOf(schema)
  return (
    <section className="wz-schema">
      <h3>{props.title}</h3>
      {schema === undefined ? (
        <p className="quiet">
          {props.missing ?? 'This validator has no JSON Schema, so its fields are not known here.'}
        </p>
      ) : rows.length === 0 ? (
        <p>
          A <code>{typeOf(schema)}</code>
          {notesOf(schema).length > 0 && (
            <span className="quiet">, {notesOf(schema).join(', ')}</span>
          )}
          .
        </p>
      ) : (
        <ul className="wz-fields">
          {rows.map((row) => (
            <li key={row.name} style={{ paddingLeft: `${row.depth * 16}px` }}>
              <code className="wz-field-name">{row.name}</code>
              <span className="wz-field-type">{row.type}</span>
              <span className="wz-field-notes">
                <span className={row.required ? 'wz-required' : 'quiet'}>
                  {row.required ? 'required' : 'optional'}
                </span>
                {row.notes.map((note) => (
                  <span key={note} className="quiet">
                    {note}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {schema !== undefined && (
        <details className="wz-raw">
          <summary>JSON Schema</summary>
          <JsonView value={schema} />
        </details>
      )}
    </section>
  )
}

/** The input, the forms and the events of a wizard, each as the fields it accepts. */
export function Schemas({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const { schemas, nodes } = wizard.manifest
  const label = (node: (typeof nodes)[number]) => [...node.path, node.id].join(' / ')
  const eventKind = (name: string): OutsideKind => {
    const source = wizard.events[name]?.source
    return source === 'webhook' || source === 'queue' ? source : 'event'
  }
  return (
    <div className="wz-schemas">
      <SchemaView
        title="Input to start a run"
        schema={schemas.context}
        missing="This wizard declares no input schema."
      />
      {nodes
        .filter((node) => node.input !== undefined)
        .map((node) => (
          <SchemaView
            key={label(node)}
            title={
              <>
                <Kind kind="form" /> <code>{label(node)}</code>
              </>
            }
            schema={node.input}
          />
        ))}
      {Object.entries(schemas.events).map(([name, schema]) => (
        <SchemaView
          key={name}
          title={
            <>
              <Kind kind={eventKind(name)} /> <code>{name}</code>
            </>
          }
          schema={schema}
        />
      ))}
    </div>
  )
}
