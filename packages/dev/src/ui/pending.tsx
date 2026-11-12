import { type ReactElement, type ReactNode, useState } from 'react'
import { exampleOf } from '../server/example'
import type { Action, ActionResult, Pending, RunDetail } from '../wire'
import { api } from './api'
import { brief, span, stepLabel } from './format'
import { JsonEditor, Refusal, useJsonDraft } from './json'
import { Kind, MEANING, type OutsideKind } from './kind'

/** Sends one action and keeps what the run answered. */
function useAction(run: string): [ActionResult | undefined, boolean, (action: Action) => void] {
  const [result, setResult] = useState<ActionResult>()
  const [busy, setBusy] = useState(false)
  const send = (action: Action) => {
    setBusy(true)
    void api
      .act(run, action)
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return [result, busy, send]
}

function Card(props: {
  readonly kind: OutsideKind
  readonly title: ReactNode
  readonly note?: string
  readonly children: ReactNode
}): ReactElement {
  return (
    <article className="card need" data-kind={props.kind}>
      <header>
        <Kind kind={props.kind} />
        <h3>{props.title}</h3>
      </header>
      <p className="quiet note">{props.note ?? MEANING[props.kind]}</p>
      {props.children}
    </article>
  )
}

function ViewCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'view' }> }) {
  const [draft, setDraft] = useJsonDraft(
    item.draft ?? exampleOf(item.schema),
    `${run.id}:${item.step}`,
  )
  const [result, busy, send] = useAction(run.id)
  return (
    <Card kind="form" title={<code>{stepLabel(item.path, item.step)}</code>}>
      <JsonEditor draft={draft} onChange={setDraft} label="What the person enters" />
      <Refusal result={result} />
      <button
        type="button"
        className="primary"
        disabled={busy || draft.error !== undefined}
        onClick={() =>
          send({ type: 'submit', path: item.path, step: item.step, input: draft.value })
        }
      >
        Submit form
      </button>
    </Card>
  )
}

function EventCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'event' }> }) {
  const [name, setName] = useState(item.events[0]?.name ?? '')
  const chosen = item.events.find((event) => event.name === name)
  const schema = chosen?.schema
  const origin = chosen?.origin
  const kind: OutsideKind =
    origin?.source === 'webhook' ? 'webhook' : origin?.source === 'queue' ? 'queue' : 'event'
  const sender = origin?.from === undefined ? '' : ` Sender: ${origin.from}.`
  const [draft, setDraft] = useJsonDraft(exampleOf(schema), `${run.id}:${item.step}:${name}`)
  const [result, busy, send] = useAction(run.id)
  return (
    <Card
      kind={kind}
      title={<code>{stepLabel(item.path, item.step)}</code>}
      note={`${MEANING[kind]}${sender} Here you send it.`}
    >
      {item.events.length > 1 && (
        <label className="field">
          <span>Event</span>
          <select value={name} onChange={(event) => setName(event.target.value)}>
            {item.events.map((event) => (
              <option key={event.name}>{event.name}</option>
            ))}
          </select>
        </label>
      )}
      <JsonEditor draft={draft} onChange={setDraft} label={`Payload of ${name}`} />
      {item.deadline !== undefined && (
        <p className="quiet">Times out in {span(item.deadline - run.now)}.</p>
      )}
      <Refusal result={result} />
      <button
        type="button"
        className="primary"
        disabled={busy || draft.error !== undefined}
        onClick={() => send({ type: 'send', event: name, payload: draft.value })}
      >
        Send {name}
      </button>
    </Card>
  )
}

function CallCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'call' }> }) {
  const [draft, setDraft] = useJsonDraft({}, `${run.id}:${item.id}`)
  const [message, setMessage] = useState('Service unavailable')
  const [result, busy, send] = useAction(run.id)
  return (
    <Card
      kind="service"
      note="The run called this service and waits for the reply. You are the service."
      title={
        <code>
          {item.name}({item.args.map((arg) => brief(arg, 40)).join(', ')})
        </code>
      }
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
        <input
          aria-label="Error message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ type: 'reject', id: item.id, message })}
        >
          Throw
        </button>
      </div>
    </Card>
  )
}

function SleepCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'sleep' }> }) {
  return (
    <Card kind="timer" title={<code>{stepLabel(item.path, item.step)}</code>}>
      <p>Wakes in {span(item.deadline - run.now)}.</p>
    </Card>
  )
}

function FailedCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'failed' }> }) {
  const [result, busy, send] = useAction(run.id)
  const message = (item.error as { message?: string } | undefined)?.message
  return (
    <Card kind="failed" title={<code>{item.step}</code>}>
      <p className="problem">{message ?? 'The step failed.'}</p>
      <Refusal result={result} />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => send({ type: 'retry', step: item.step })}
        >
          Retry
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ type: 'skip', step: item.step })}
        >
          Skip
        </button>
      </div>
    </Card>
  )
}

/** Everything the run waits for, each with the control that supplies it. */
export function PendingList({ run }: { readonly run: RunDetail }): ReactElement {
  const [result, busy, send] = useAction(run.id)
  return (
    <section className="needs" aria-label="Waiting for you">
      {run.pending.map((item) => {
        if (item.kind === 'view')
          return <ViewCard key={`view:${stepLabel(item.path, item.step)}`} run={run} item={item} />
        if (item.kind === 'event')
          return (
            <EventCard key={`event:${stepLabel(item.path, item.step)}`} run={run} item={item} />
          )
        if (item.kind === 'call') return <CallCard key={item.id} run={run} item={item} />
        if (item.kind === 'sleep')
          return (
            <SleepCard key={`sleep:${stepLabel(item.path, item.step)}`} run={run} item={item} />
          )
        return <FailedCard key={`failed:${item.step}`} run={run} item={item} />
      })}
      {run.nextTimer !== undefined && (
        <div className="timer">
          <span>
            Next timer fires in <strong>{span(run.nextTimer - run.now)}</strong>. It may be a sleep,
            a timeout or a retry delay.
          </span>
          <button type="button" disabled={busy} onClick={() => send({ type: 'skipTimer' })}>
            Skip to it
          </button>
          <Refusal result={result} />
        </div>
      )}
    </section>
  )
}
