import { type ReactElement, useState } from 'react'
import { exampleOf } from '../server/example'
import type { Pending, RunDetail } from '../wire'
import { CallCard } from './call-card'
import { fieldIssues, restOf, ValueEditor } from './fields'
import { brief, stepLabel } from './format'
import { Refusal, useJsonDraft } from './json'
import { MEANING, type OutsideKind } from './kind'
import { advanceCode, Card, Deadline, scope, useAction } from './need'

function ViewCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'view' }> }) {
  const [draft, setDraft] = useJsonDraft(
    item.draft ?? exampleOf(item.schema),
    `${run.id}:${item.step}`,
  )
  const [result, busy, send] = useAction(run.id)
  const issues = fieldIssues(item.schema, result)
  const at = scope(item.path)
  return (
    <Card
      kind="form"
      title={<code>{stepLabel(item.path, item.step)}</code>}
      code={`await ${at}.setInput('${item.step}', ${brief(draft.value, 60)})\nawait ${at}.next()`}
    >
      <ValueEditor
        schema={item.schema}
        draft={draft}
        onChange={setDraft}
        label="What the person enters"
        issues={issues}
      />
      <Refusal result={restOf(result, issues)} />
      <div className="row">
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
      </div>
    </Card>
  )
}

function EventCard(props: {
  run: RunDetail
  item: Extract<Pending, { kind: 'event' }>
}): ReactElement {
  const { run, item } = props
  const [name, setName] = useState(item.events[0]?.name ?? '')
  const chosen = item.events.find((event) => event.name === name)
  const origin = chosen?.origin
  const kind: OutsideKind =
    origin?.source === 'webhook' ? 'webhook' : origin?.source === 'queue' ? 'queue' : 'event'
  const sender = origin?.from === undefined ? '' : ` Sender: ${origin.from}.`
  const [draft, setDraft] = useJsonDraft(
    chosen?.example ?? exampleOf(chosen?.schema),
    `${run.id}:${item.step}:${name}`,
  )
  const [result, busy, send] = useAction(run.id)
  const issues = fieldIssues(chosen?.schema, result)
  return (
    <Card
      kind={kind}
      title={<code>{stepLabel(item.path, item.step)}</code>}
      note={`${MEANING[kind]}${sender} Here you send it.`}
      code={`await run.send('${name}', ${brief(draft.value, 60)})`}
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
      <ValueEditor
        schema={chosen?.schema}
        draft={draft}
        onChange={setDraft}
        label={`Payload of ${name}`}
        issues={issues}
      />
      <Refusal result={restOf(result, issues)} />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy || draft.error !== undefined}
          onClick={() => send({ type: 'send', event: name, payload: draft.value })}
        >
          Send {name}
        </button>
      </div>
      {item.deadline !== undefined && (
        <Deadline
          run={run.id}
          left={item.deadline - run.now}
          next={item.deadline === run.nextTimer}
          verb="Times out"
          effect="the wait times out now"
        />
      )}
    </Card>
  )
}

function SleepCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'sleep' }> }) {
  return (
    <Card
      kind="timer"
      title={<code>{stepLabel(item.path, item.step)}</code>}
      note="The step sleeps until a set time, then the run goes on."
      code={advanceCode(item.deadline - run.now)}
    >
      <Deadline
        run={run.id}
        left={item.deadline - run.now}
        next={item.deadline === run.nextTimer}
        verb="Wakes"
        effect="the step wakes now"
      />
    </Card>
  )
}

/** A timer no card owns: a retry delay, or the timeout of a step that runs work. */
function TimerCard({ run, at }: { run: RunDetail; at: number }): ReactElement {
  return (
    <Card
      kind="timer"
      title="Next timer"
      note="Nothing above waits on it, so it is a retry delay or the timeout of a running step."
      code={advanceCode(at - run.now)}
    >
      <Deadline run={run.id} left={at - run.now} next verb="Fires" effect="it fires now" />
    </Card>
  )
}

function FailedCard({ run, item }: { run: RunDetail; item: Extract<Pending, { kind: 'failed' }> }) {
  const [result, busy, send] = useAction(run.id)
  const message = (item.error as { message?: string } | undefined)?.message
  return (
    <Card
      kind="failed"
      title={<code>{item.step}</code>}
      note="The step threw and the run halted. Nothing goes on until you retry or skip it."
      code={`await run.retry('${item.step}')\nawait run.skip('${item.step}')`}
    >
      <p className="failure">{message ?? 'The step failed without a message.'}</p>
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
        <span className="quiet hint">
          Retry runs the step again. Skip marks it skipped and goes on.
        </span>
      </div>
    </Card>
  )
}

const keyOf = (item: Pending): string =>
  item.kind === 'call'
    ? item.id
    : item.kind === 'failed'
      ? `failed:${item.step}`
      : `${item.kind}:${stepLabel(item.path, item.step)}`

/** True when a card shows the run's next timer, so it needs no card of its own. */
const ownsTimer = (run: RunDetail): boolean =>
  run.pending.some(
    (item) => (item.kind === 'event' || item.kind === 'sleep') && item.deadline === run.nextTimer,
  )

/**
 * Everything a live run waits for, each with the control that supplies it, or a note that the
 * run is working. It stays mounted while the run lives, so choices such as an open throw panel
 * outlast a moment with nothing to do.
 */
export function PendingList({ run }: { readonly run: RunDetail }): ReactElement {
  // Service names whose "Make it throw" panel is open, kept across calls to the same service.
  const [throwing, setThrowing] = useState<ReadonlySet<string>>(() => new Set())
  const owned = ownsTimer(run)
  const count = run.pending.length + (run.nextTimer !== undefined && !owned ? 1 : 0)
  if (count === 0)
    return (
      <div className="working" role="status">
        <span className="pulse" aria-hidden="true" />
        <div>
          <p>The run is working. Nothing needs you right now.</p>
          <p className="quiet">
            Steps run on their own. A card shows up here when the run needs an answer.
          </p>
        </div>
      </div>
    )
  return (
    <section className="needs" aria-labelledby="needs-title">
      <h2 className="section" id="needs-title">
        Waiting for you <span className="count-pill">{count}</span>
      </h2>
      {run.pending.map((item) => {
        const key = keyOf(item)
        if (item.kind === 'view') return <ViewCard key={key} run={run} item={item} />
        if (item.kind === 'event') return <EventCard key={key} run={run} item={item} />
        if (item.kind === 'sleep') return <SleepCard key={key} run={run} item={item} />
        if (item.kind === 'failed') return <FailedCard key={key} run={run} item={item} />
        return (
          <CallCard
            key={key}
            run={run}
            item={item}
            throwing={throwing.has(item.name)}
            onThrowing={(open) => {
              const next = new Set(throwing)
              if (open) next.add(item.name)
              else next.delete(item.name)
              setThrowing(next)
            }}
          />
        )
      })}
      {run.nextTimer !== undefined && !owned && <TimerCard run={run} at={run.nextTimer} />}
    </section>
  )
}
