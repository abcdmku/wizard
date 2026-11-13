import { type ReactElement, useId, useState } from 'react'
import type { Pending, RunDetail } from '../wire'
import { brief } from './format'
import { JsonEditor, Refusal, useJsonDraft } from './json'
import { Card, useAction } from './need'

/**
 * A service call the person answers. Return is the main action. Throwing sits behind a toggle
 * that shows the error message, and `throwing` keeps that toggle open for the next call.
 */
export function CallCard(props: {
  readonly run: RunDetail
  readonly item: Extract<Pending, { kind: 'call' }>
  readonly throwing: boolean
  readonly onThrowing: (open: boolean) => void
}): ReactElement {
  const { run, item } = props
  const [draft, setDraft] = useJsonDraft(item.example ?? {}, `${run.id}:${item.id}`)
  const [message, setMessage] = useState('Service unavailable')
  const [result, busy, send] = useAction(run.id)
  const panel = useId()
  const call = `deps.${item.name}(${item.args.map((arg) => brief(arg, 40)).join(', ')})`
  return (
    <Card
      kind="service"
      note="The run called this service and waits for the reply. You are the service."
      title={
        <code>
          {item.name}({item.args.map((arg) => brief(arg, 40)).join(', ')})
        </code>
      }
      code={`const reply = await ${call}\n// Return resolves this promise with the value.\n// Throw rejects it with an Error.`}
    >
      <JsonEditor draft={draft} onChange={setDraft} label="Return value" />
      <Refusal result={result} />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy || draft.error !== undefined}
          onClick={() => send({ type: 'resolve', id: item.id, value: draft.value })}
        >
          Return
        </button>
        <button
          type="button"
          className="toggle"
          aria-expanded={props.throwing}
          aria-controls={panel}
          onClick={() => props.onThrowing(!props.throwing)}
        >
          Make it throw
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 6.5 8 10l3.5-3.5" />
          </svg>
        </button>
      </div>
      {props.throwing && (
        <div className="throw" id={panel}>
          <label className="field">
            <span>Error message</span>
            <input
              value={message}
              autoComplete="off"
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => send({ type: 'reject', id: item.id, message })}
          >
            Throw
          </button>
        </div>
      )}
    </Card>
  )
}
