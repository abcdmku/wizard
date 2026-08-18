/**
 * `<JsonView>` — a value as indented JSON (`undefined` / functions / bigints made visible),
 * folded past a size limit with a toggle.
 */

import { type ReactElement, useState } from 'react'

const FOLD_AT = 600

export function toJson(value: unknown): string {
  const text = JSON.stringify(
    value,
    (_key, v: unknown) => {
      if (typeof v === 'bigint') return `${v}n`
      if (typeof v === 'function') return '[function]'
      if (v === undefined) return '[undefined]'
      return v
    },
    2,
  )
  return text === undefined ? 'undefined' : text
}

export function JsonView({
  value,
  label,
}: {
  readonly value: unknown
  readonly label?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const text = toJson(value)
  const long = text.length > FOLD_AT
  return (
    <div className="owd-json">
      {label !== undefined && <div className="owd-json-label">{label}</div>}
      <pre className="owd-json-pre">{long && !open ? `${text.slice(0, FOLD_AT)}…` : text}</pre>
      {long && (
        <button type="button" className="owd-link" onClick={() => setOpen(!open)}>
          {open ? 'show less' : `show all (${text.length} chars)`}
        </button>
      )}
    </div>
  )
}
