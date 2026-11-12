/**
 * What the reader can do to a live run right now: start it, fill in a form, send an event,
 * answer a service call, move time forward, retry a halted step or restart the process. Each
 * card has the badge the dev UI gives the same kind of thing.
 */
import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Live, LiveState } from './live'
import { SchemaForm } from './live-fields'
import { duration } from './live-format'

type Kind = 'run' | 'form' | 'event' | 'service' | 'timer' | 'failed' | 'done'

const LABEL: Readonly<Record<Kind, string>> = {
  run: 'Run',
  form: 'Form',
  event: 'Event',
  service: 'Service call',
  timer: 'Timer',
  failed: 'Failed step',
  done: 'Done',
}

/** The same icons as the dev UI badges, drawn on a 16 by 16 grid. */
const PATHS: Readonly<Record<Kind, string>> = {
  run: 'M5 3.5v9l7-4.5z',
  form: 'M3 13h10M4.5 10.5l.5-2.5 5.5-5.5 2 2L7 10z',
  event: 'M9 2 4 9h3.5L7 14l5-7H8.5z',
  service: 'M3 3v10M6 8h7.5M10.5 5l3 3-3 3',
  timer: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
  failed: 'M4 4l8 8M12 4l-8 8',
  done: 'M3.5 8.5l3 3 6-7',
}

function Card({
  kind,
  title,
  children,
}: {
  readonly kind: Kind
  readonly title: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <li className="lv-card" data-kind={kind}>
      <p className="lv-card-title">
        <span className="lv-kind">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={PATHS[kind]} />
          </svg>
          {LABEL[kind]}
        </span>
        <span>{title}</span>
      </p>
      {children}
    </li>
  )
}

const where = (path: readonly string[]): string =>
  path.length === 0 ? '' : ` in ${path.join(' / ')}`

const ENDED: Readonly<Record<string, string>> = {
  done: 'The run is done.',
  failed: 'The run failed.',
  cancelled: 'The run was cancelled.',
}

export function LivePortal({
  live,
  state,
  restart,
}: {
  readonly live: Live
  readonly state: LiveState
  readonly restart: () => void
}) {
  const busy = state.busy
  const cards: ReactNode[] = []

  if (!state.started) {
    cards.push(
      <Card key="start" kind="run" title="Nothing has started">
        <button type="button" className="lv-primary" disabled={busy} onClick={() => live.start()}>
          run.start()
        </button>
      </Card>,
    )
  }

  for (const form of state.forms) {
    cards.push(
      <Card
        key={`form:${form.key}`}
        kind="form"
        title={
          <>
            <b>{form.id}</b>
            {where(form.path)} waits for a person
          </>
        }
      >
        <SchemaForm
          schema={form.schema}
          initial={form.draft}
          submit="Submit"
          disabled={busy}
          onSubmit={(values) => live.submit(form, values)}
        />
        {form.issue && <p className="lv-issue">Refused: {form.issue}</p>}
      </Card>,
    )
  }

  for (const event of state.events) {
    cards.push(
      <Card
        key={`event:${event.key}`}
        kind="event"
        title={
          <>
            <b>{event.step}</b> waits for <code>{event.name}</code>
          </>
        }
      >
        <SchemaForm
          schema={event.schema}
          initial={event.payload}
          submit={`Send ${event.name}`}
          disabled={busy}
          onSubmit={(payload) => live.send(event, payload)}
        />
      </Card>,
    )
  }

  for (const call of state.calls.filter((item) => item.state === 'pending')) {
    cards.push(
      <Card key={`call:${call.id}`} kind="service" title="The run waits for the reply">
        <p className="lv-card-line">
          deps.{call.name}({call.args})
        </p>
        <div className="lv-actions">
          <button
            type="button"
            className="lv-primary"
            disabled={busy}
            onClick={() => live.answer(call, 'returned')}
          >
            Return {call.reply}
          </button>
          {call.fail && (
            <button
              type="button"
              className="lv-danger"
              disabled={busy}
              onClick={() => live.answer(call, 'threw')}
            >
              Throw '{call.fail}'
            </button>
          )}
        </div>
      </Card>,
    )
  }

  if (state.halted) {
    const { step, message } = state.halted
    cards.push(
      <Card key="halted" kind="failed" title="The run halted">
        <p className="lv-card-line">
          {step} failed: {message}
        </p>
        <button
          type="button"
          className="lv-primary"
          disabled={busy}
          onClick={() => live.retry(step)}
        >
          run.retry('{step}')
        </button>
      </Card>,
    )
  }

  if (state.nextTimer !== undefined) {
    cards.push(
      <Card key="timer" kind="timer" title={`Fires in ${duration(state.nextTimer)}`}>
        <button type="button" disabled={busy} onClick={() => live.advance()}>
          Skip {duration(state.nextTimer)} ahead
        </button>
      </Card>,
    )
  }

  if (state.canResume) {
    cards.push(
      <Card key="resume" kind="run" title="Stop the process">
        <p className="lv-card-line">
          Save the run, throw the object away and resume from the store.
        </p>
        <button type="button" disabled={busy} onClick={() => live.saveAndResume()}>
          Save and resume
        </button>
      </Card>,
    )
  }

  const ended = ENDED[state.run]
  if (ended) {
    cards.push(
      <Card key="ended" kind={state.run === 'done' ? 'done' : 'failed'} title={ended}>
        <button type="button" onClick={restart}>
          <RotateCcw aria-hidden="true" />
          Run it again
        </button>
      </Card>,
    )
  } else if (state.started && cards.length === 0) {
    cards.push(<Card key="working" kind="run" title="The run is settling" />)
  }

  return (
    <div className="lv-portal">
      <p className="lv-portal-title">Your turn</p>
      <ul>{cards}</ul>
    </div>
  )
}
