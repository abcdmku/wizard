import { type ReactElement, useId, useState } from 'react'
import type { Schema } from '../wire'
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

/**
 * An editor for a value with a schema. A flat object gets one input per property. Anything
 * else, or a person who asks for it, gets the JSON.
 */
export function ValueEditor(props: {
  readonly schema: Schema | undefined
  readonly draft: JsonDraft
  readonly onChange: (text: string) => void
  readonly label: string
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
        return (
          <label key={field.name} htmlFor={input} className="field" data-type={field.type}>
            <span>{field.name}</span>
            {field.type === 'enum' ? (
              <select
                id={input}
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
                checked={current === true}
                onChange={(event) => set(field.name, event.target.checked)}
              />
            ) : field.type === 'number' ? (
              <input
                id={input}
                type="number"
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
                autoComplete="off"
                value={typeof current === 'string' ? current : ''}
                onChange={(event) => set(field.name, event.target.value)}
              />
            )}
          </label>
        )
      })}
      <button type="button" className="link" onClick={() => setAsJson(true)}>
        Edit as JSON
      </button>
    </fieldset>
  )
}
