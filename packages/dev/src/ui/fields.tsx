import { type ReactElement, useId, useState } from 'react'
import type { ActionResult, Schema } from '../wire'
import { pretty } from './format'
import { type JsonDraft, JsonEditor } from './json'

interface Field {
  readonly name: string
  readonly type: 'string' | 'number' | 'boolean' | 'enum'
  readonly options?: readonly string[]
}

type Loose = {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, Loose>>
}

const SIMPLE = new Set(['string', 'number', 'integer', 'boolean'])

/** One field per property, or nothing when the schema holds more than flat values. */
function fieldsOf(schema: Schema | undefined): readonly Field[] | undefined {
  const properties = (schema as Loose | undefined)?.properties
  if (properties === undefined || Object.keys(properties).length === 0) return undefined
  const fields: Field[] = []
  for (const [name, property] of Object.entries(properties)) {
    if (Array.isArray(property.enum) && property.enum.every((item) => typeof item === 'string'))
      fields.push({ name, type: 'enum', options: property.enum as string[] })
    else if (typeof property.type !== 'string' || !SIMPLE.has(property.type)) return undefined
    else if (property.type === 'boolean') fields.push({ name, type: 'boolean' })
    else fields.push({ name, type: property.type === 'string' ? 'string' : 'number' })
  }
  return fields
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Issue = NonNullable<ActionResult['issues']>[number]

/** The issues of a refused action that name a field of the editor, by field name. */
export function fieldIssues(
  schema: Schema | undefined,
  result: ActionResult | undefined,
): ReadonlyMap<string, string> {
  const names = new Set(fieldsOf(schema)?.map((field) => field.name))
  const found = new Map<string, string>()
  if (result === undefined || result.ok) return found
  for (const issue of result.issues ?? []) {
    const name = issue.path?.[0]
    if (typeof name === 'string' && names.has(name) && !found.has(name))
      found.set(name, issue.message)
  }
  return found
}

/** A refused result without the issues the fields already show. */
export function restOf(
  result: ActionResult | undefined,
  shown: ReadonlyMap<string, string>,
): ActionResult | undefined {
  if (result === undefined || result.ok || result.issues === undefined || shown.size === 0)
    return result
  const issues = result.issues.filter(
    (issue: Issue) => !(typeof issue.path?.[0] === 'string' && shown.has(issue.path[0])),
  )
  return issues.length === 0 ? undefined : { ...result, issues }
}

/**
 * An editor for a value with a schema. A flat object gets one input per property. Anything
 * else, or a person who asks for it, gets the JSON.
 */
export function ValueEditor(props: {
  readonly schema: Schema | undefined
  readonly draft: JsonDraft
  readonly onChange: (text: string) => void
  readonly label: string
  /** What a refused submit said about each field, by field name. */
  readonly issues?: ReadonlyMap<string, string>
}): ReactElement {
  const id = useId()
  const fields = fieldsOf(props.schema)
  const [asJson, setAsJson] = useState(false)
  const { value } = props.draft
  if (fields === undefined || asJson || !isRecord(value))
    return (
      <div className="stack">
        <JsonEditor draft={props.draft} onChange={props.onChange} label={props.label} />
        {fields !== undefined && isRecord(value) && (
          <button type="button" className="link" onClick={() => setAsJson(false)}>
            Edit as fields
          </button>
        )}
      </div>
    )
  const set = (name: string, next: unknown) => {
    const { [name]: _old, ...rest } = value
    props.onChange(pretty(next === undefined ? rest : { ...rest, [name]: next }))
  }
  return (
    <fieldset className="fields">
      <legend>{props.label}</legend>
      {fields.map((field) => {
        const input = `${id}-${field.name}`
        const current = value[field.name]
        const issue = props.issues?.get(field.name)
        const invalid =
          issue === undefined
            ? {}
            : {
                'aria-invalid': true,
                'aria-describedby': `${input}-issue`,
              }
        return (
          <div key={field.name} className="field" data-type={field.type}>
            <label htmlFor={input}>{field.name}</label>
            {field.type === 'enum' ? (
              <select
                id={input}
                {...invalid}
                value={String(current ?? '')}
                onChange={(event) => set(field.name, event.target.value)}
              >
                {field.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <input
                id={input}
                type="checkbox"
                {...invalid}
                checked={current === true}
                onChange={(event) => set(field.name, event.target.checked)}
              />
            ) : field.type === 'number' ? (
              <input
                id={input}
                type="number"
                {...invalid}
                inputMode="decimal"
                value={typeof current === 'number' ? current : ''}
                onChange={(event) =>
                  set(
                    field.name,
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              />
            ) : (
              <input
                id={input}
                type="text"
                {...invalid}
                autoComplete="off"
                value={typeof current === 'string' ? current : ''}
                onChange={(event) => set(field.name, event.target.value)}
              />
            )}
            {issue !== undefined && (
              <span className="issue" id={`${input}-issue`}>
                {issue}
              </span>
            )}
          </div>
        )
      })}
      <button type="button" className="link" onClick={() => setAsJson(true)}>
        Edit as JSON
      </button>
    </fieldset>
  )
}
