/** A form built from a JSON Schema: one input per property, typed by the schema. */
import type { JSONSchema } from '@openwizard/core/inspect'
import { type FormEvent, useId, useState } from 'react'

interface Field {
  readonly name: string
  readonly type: 'string' | 'number' | 'boolean' | 'enum'
  readonly options?: readonly string[]
}

type Schemaish = {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, Schemaish>>
}

function fieldsOf(schema: JSONSchema | undefined, draft: Readonly<Record<string, unknown>>) {
  const properties = (schema as Schemaish | undefined)?.properties
  if (!properties) {
    return Object.keys(draft).map((name): Field => ({ name, type: 'string' }))
  }
  return Object.entries(properties).map(([name, property]): Field => {
    if (Array.isArray(property.enum)) {
      return { name, type: 'enum', options: property.enum.map(String) }
    }
    if (property.type === 'number' || property.type === 'integer') return { name, type: 'number' }
    if (property.type === 'boolean') return { name, type: 'boolean' }
    return { name, type: 'string' }
  })
}

const asText = (value: unknown): string =>
  value === undefined || value === null ? '' : typeof value === 'string' ? value : String(value)

/** Reads the inputs back as the values the schema expects. An empty number is left out. */
function valuesOf(fields: readonly Field[], text: Readonly<Record<string, string>>) {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = text[field.name] ?? ''
    if (field.type === 'boolean') values[field.name] = raw === 'true'
    else if (field.type === 'number') {
      if (raw.trim() !== '') values[field.name] = Number(raw)
    } else values[field.name] = raw
  }
  return values
}

export function SchemaForm({
  schema,
  initial,
  submit,
  disabled,
  onSubmit,
}: {
  readonly schema: JSONSchema | undefined
  readonly initial: Readonly<Record<string, unknown>>
  readonly submit: string
  readonly disabled: boolean
  readonly onSubmit: (values: Record<string, unknown>) => void
}) {
  const id = useId()
  const fields = fieldsOf(schema, initial)
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, asText(initial[field.name])])),
  )
  const set = (name: string, value: string) => setText((current) => ({ ...current, [name]: value }))
  const send = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(valuesOf(fields, text))
  }
  return (
    <form className="lv-form" onSubmit={send}>
      {fields.map((field) => {
        const input = `${id}-${field.name}`
        const value = text[field.name] ?? ''
        return (
          <label key={field.name} htmlFor={input} className="lv-field">
            <span>{field.name}</span>
            {field.type === 'enum' ? (
              <select id={input} value={value} onChange={(e) => set(field.name, e.target.value)}>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <input
                id={input}
                type="checkbox"
                checked={value === 'true'}
                onChange={(e) => set(field.name, String(e.target.checked))}
              />
            ) : (
              <input
                id={input}
                type={field.type === 'number' ? 'number' : 'text'}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={value}
                autoComplete="off"
                onChange={(e) => set(field.name, e.target.value)}
              />
            )}
          </label>
        )
      })}
      <button type="submit" className="lv-primary" disabled={disabled}>
        {submit}
      </button>
    </form>
  )
}
