/**
 * What the reader can do to a live run right now: start it, fill in a form, send an event,
 * answer a service call, move time forward, retry a halted step or restart the process.
 */
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Play,
  RotateCcw,
  Save,
  SquarePen,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Live, LiveState } from './live'
import { SchemaForm } from './live-fields'
import { duration } from './live-format'

function Card({
  icon,
  title,
  tone,
  children,
}: {
  readonly icon: ReactNode
  readonly title: ReactNode
  readonly tone: 'waiting' | 'running' | 'done' | 'failed'
  readonly children: ReactNode
}) {
  return (
    <li className={`lv-card is-${tone}`}>
      <p className="lv-card-title">
        {icon}
        {title}
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
  const pending = state.calls.filter((call) => call.state === 'pending')
  const cards: ReactNode[] = []

  if (!state.started) {
    cards.push(
      <Card
        key="start"
        icon={<Play aria-hidden="true" />}
        title="Nothing has started"
        tone="waiting"
      >
        <p className="lv-card-line">Start the run to see which steps begin.</p>
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
        icon={<SquarePen aria-hidden="true" />}
        title={
          <>
            Form for <b>{form.id}</b>
            {where(form.path)}
          </>
        }
        tone={form.issue ? 'failed' : 'waiting'}
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
        icon={<ArrowDownLeft aria-hidden="true" />}
        title={
          <>
            <b>{event.step}</b> waits for <code>{event.name}</code>
          </>
        }
        tone="waiting"
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

  for (const call of pending) {
    cards.push(
      <Card
        key={`call:${call.id}`}
        icon={<ArrowUpRight aria-hidden="true" />}
        title="A step called your service"
        tone="running"
      >
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
      <Card
        key="halted"
        icon={<TriangleAlert aria-hidden="true" />}
        title="The run halted"
        tone="failed"
      >
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
      <Card key="timer" icon={<Clock aria-hidden="true" />} title="A timer is set" tone="waiting">
        <p className="lv-card-line">It fires in {duration(state.nextTimer)}.</p>
        <button type="button" disabled={busy} onClick={() => live.advance()}>
          Skip {duration(state.nextTimer)} ahead
        </button>
      </Card>,
    )
  }

  if (state.canResume) {
    cards.push(
      <Card key="resume" icon={<Save aria-hidden="true" />} title="Stop the process" tone="waiting">
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
      <Card
        key="ended"
        icon={<Check aria-hidden="true" />}
        title={ended}
        tone={state.run === 'done' ? 'done' : 'failed'}
      >
        <button type="button" onClick={restart}>
          <RotateCcw aria-hidden="true" />
          Run it again
        </button>
      </Card>,
    )
  } else if (state.started && cards.length === 0) {
    cards.push(
      <Card key="working" icon={<Clock aria-hidden="true" />} title="Working" tone="running">
        <p className="lv-card-line">The run is settling.</p>
      </Card>,
    )
  }

  return (
    <div className="lv-portal">
      <p className="lv-portal-title">Your turn</p>
      <ul>{cards}</ul>
    </div>
  )
}
