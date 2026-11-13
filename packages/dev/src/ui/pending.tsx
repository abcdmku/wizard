import type { Manifest } from '@openwizard/core/inspect'
import { type ReactElement, useEffect, useState } from 'react'
import { exampleOf } from '../server/example'
import type { Pending, RunDetail } from '../wire'
import { CallCard } from './call-card'
import { fieldIssues, restOf, ValueEditor } from './fields'
import { literal, stepLabel } from './format'
import { Refusal, useJsonDraft } from './json'
import { MEANING, type OutsideKind } from './kind'
import { advanceCode, Card, Deadline, scope, useAction } from './need'
import { nodeOf } from './step-facts'
import { TimerCard } from './timer-card'

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
      code={`await ${at}.setInput('${item.step}', ${literal(draft.value)})\nawait ${at}.next()`}
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
  const sender = origin?.from === undefined ? '' : ` Sent by: ${origin.from}.`
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
      code={`await run.send('${name}', ${literal(draft.value)})`}
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

function SleepCard(props: {
  run: RunDetail
  item: Extract<Pending, { kind: 'sleep' }>
  manifest: Manifest | undefined
}) {
  const { run, item } = props
  const sleep = nodeOf(props.manifest, [...item.path, item.step].join('/'))?.sleep
  return (
    <Card
      kind="timer"
      title={<code>{stepLabel(item.path, item.step)}</code>}
      note="The step sleeps until a set time, then the run goes on by itself."
      code={advanceCode(item.deadline - run.now, typeof sleep === 'number' ? sleep : undefined)}
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

/** True after `ms` of `on` in a row, so a moment between two actions does not flash. */
function useSettled(on: boolean, ms = 700): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!on) {
      setSettled(false)
      return
    }
    const timer = setTimeout(() => setSettled(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return settled
}

/**
 * Everything a live run waits for. "Waiting for you" holds what a person supplies, each with
 * the control that supplies it; its count is `run.waiting`, the number the run list shows.
 * "Timers" holds sleeps and the next timer, which fire by themselves and can be skipped. With
 * neither, a note says the run is working, after a short pause so it does not flash between
 * two actions. The list stays mounted while the run lives, so choices such as an open throw
 * panel outlast a moment with nothing to do.
 */
export function PendingList(props: {
  readonly run: RunDetail
  readonly manifest: Manifest | undefined
}): ReactElement | null {
  const { run } = props
  // Service names whose "Make it throw" panel is open, kept across calls to the same service.
  const [throwing, setThrowing] = useState<ReadonlySet<string>>(() => new Set())
  const forYou = run.pending.filter((item) => item.kind !== 'sleep')
  const sleeps = run.pending.filter((item) => item.kind === 'sleep')
  const loose = run.nextTimer !== undefined && !ownsTimer(run)
  const idle = forYou.length === 0 && sleeps.length === 0 && !loose
  const working = useSettled(idle)
  if (idle)
    return working ? (
      <div className="working" role="status">
        <span className="pulse" aria-hidden="true" />
        <div>
          <p>The run is working. Nothing needs you right now.</p>
          <p className="quiet">
            Steps run on their own. A card shows up here when the run needs an answer.
          </p>
        </div>
      </div>
    ) : null
  return (
    <>
      {forYou.length > 0 && (
        <section className="needs" aria-labelledby="needs-title">
          <h2 className="section" id="needs-title">
            Waiting for you <span className="count-pill">{run.waiting}</span>
          </h2>
          {forYou.map((item) => {
            const key = keyOf(item)
            if (item.kind === 'view') return <ViewCard key={key} run={run} item={item} />
            if (item.kind === 'event') return <EventCard key={key} run={run} item={item} />
            if (item.kind === 'failed') return <FailedCard key={key} run={run} item={item} />
            if (item.kind !== 'call') return null
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
        </section>
      )}
      {(sleeps.length > 0 || loose) && (
        <section className="needs timers" aria-labelledby="timers-title">
          <h2 className="section" id="timers-title">
            Timers{' '}
            <span className="quiet section-note">
              They fire by themselves. Skip one to move the run's clock.
            </span>
          </h2>
          {sleeps.map((item) =>
            item.kind === 'sleep' ? (
              <SleepCard key={keyOf(item)} run={run} item={item} manifest={props.manifest} />
            ) : null,
          )}
          {loose && run.nextTimer !== undefined && (
            <TimerCard run={run} at={run.nextTimer} manifest={props.manifest} />
          )}
        </section>
      )}
    </>
  )
}
