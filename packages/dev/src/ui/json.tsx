import { type ReactElement, useEffect, useState } from 'react'
import type { ActionResult } from '../wire'
import { pretty } from './format'

/** A value shown as JSON. */
export function JsonView({ value }: { readonly value: unknown }): ReactElement {
  return <pre className="json">{pretty(value)}</pre>
}

/** A button that copies a value as pretty JSON, and says so for a moment. */
export function CopyJson({ value }: { readonly value: unknown }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    void navigator.clipboard
      ?.writeText(pretty(value))
      .then(() => setCopied(true))
      .catch(() => undefined)
  }
  return (
    <button type="button" className="copy-json" onClick={copy}>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy JSON'}</span>
    </button>
  )
}

/** What a JSON editor holds: the text, and the value when the text parses. */
export interface JsonDraft {
  readonly text: string
  readonly value: unknown
  readonly error?: string
}

const parse = (text: string): JsonDraft => {
  try {
    return { text, value: text.trim() === '' ? undefined : JSON.parse(text) }
  } catch (error) {
    return { text, value: undefined, error: (error as Error).message }
  }
}

/** A draft that starts from `initial` and starts over when `resetKey` changes. */
export function useJsonDraft(
  initial: unknown,
  resetKey: string,
): [JsonDraft, (text: string) => void] {
  const [draft, setDraft] = useState<JsonDraft>(() => parse(pretty(initial)))
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft restarts for a new subject, not for a new object
  useEffect(() => setDraft(parse(pretty(initial))), [resetKey])
  return [draft, (text) => setDraft(parse(text))]
}

/** A text area for JSON that says when the text does not parse. */
export function JsonEditor(props: {
  readonly draft: JsonDraft
  readonly onChange: (text: string) => void
  readonly label: string
  readonly rows?: number
}): ReactElement {
  const lines = props.draft.text.split('\n').length
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        spellCheck={false}
        rows={Math.min(14, Math.max(props.rows ?? 3, lines))}
        value={props.draft.text}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.draft.error !== undefined}
      />
      {props.draft.error !== undefined && <span className="problem">{props.draft.error}</span>}
    </label>
  )
}

/**
 * What a schema issue says, in words a person reads: a value the schema expected and did not
 * get reads `by is required`, by the issue's path. Any other issue keeps the validator's message.
 */
export function issueText(issue: {
  readonly message: string
  readonly path?: readonly unknown[]
}): string {
  if (!/expected .+, received undefined/i.test(issue.message)) return issue.message
  const name = issue.path?.map(String).join('.') ?? ''
  return name === '' ? 'A value is required' : `${name} is required`
}

/** What a refused action said: the message and each issue with the field it is about. */
export function Refusal({
  result,
}: {
  readonly result: ActionResult | undefined
}): ReactElement | null {
  if (result === undefined || result.ok) return null
  return (
    <div className="problem" role="alert">
      {result.issues === undefined || result.issues.length === 0 ? (
        result.message
      ) : (
        <ul>
          {result.issues.map((issue) => (
            <li key={`${issue.path?.join('.')}:${issue.message}`}>
              {issueText(issue).endsWith(' is required') ? (
                issueText(issue)
              ) : (
                <>
                  {issue.path !== undefined && issue.path.length > 0 && (
                    <code>{issue.path.map(String).join('.')}</code>
                  )}{' '}
                  {issue.message}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
