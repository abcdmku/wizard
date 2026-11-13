import type { AnyWizardDefinition, RunEvent } from '@openwizard/core'
import { Fragment, type ReactElement, useMemo, useState } from 'react'
import { clock } from './format'
import { JsonView } from './json'
import { elapsed, type Line, type LooseEvent, lines } from './story'

type Row = { readonly event: LooseEvent; readonly line: Line; readonly key: string }

const wall = (at: number): string => `${new Date(at).toLocaleDateString()} ${clock(at)}`

/**
 * The events of a run as sentences, oldest first, so the table reads top to bottom like the
 * graph runs left to right and matches `formatTrace(run.log())`. By default it shows the events
 * that tell the story and hides the bookkeeping; "All events" shows every one. A row opens to
 * the whole event as JSON.
 */
export function History(props: {
  readonly events: readonly RunEvent<AnyWizardDefinition>[]
  readonly onStep: (key: string) => void
}): ReactElement {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [all, setAll] = useState(false)
  const events = props.events as unknown as readonly LooseEvent[]
  const rows = useMemo<readonly Row[]>(() => {
    const told = lines(events)
    // A child event repeats the seq of its own run, so the key needs the index too.
    return events.map((event, index) => ({
      event,
      line: told[index] as Line,
      key: `${index}:${event.seq}:${event.type}`,
    }))
  }, [events])
  const start = events[0]?.at ?? 0
  const needle = filter.trim().toLowerCase()
  const matches = (row: Row) =>
    needle === '' ||
    `${row.line.step?.join(' / ') ?? ''} ${row.line.text} ${JSON.stringify(row.event)}`
      .toLowerCase()
      .includes(needle)
  const shown = rows.filter((row) => (all || row.line.story) && matches(row))
  const hidden = all ? 0 : rows.filter((row) => !row.line.story && matches(row)).length

  return (
    <div className="history">
      <div className="history-bar">
        <input
          className="history-filter"
          type="search"
          placeholder="Filter events"
          aria-label="Filter events"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <fieldset className="segmented">
          <legend className="visually-hidden">Which events to show</legend>
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
            Key events
          </button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
            All events
          </button>
        </fieldset>
        <span className="quiet history-count" aria-live="polite">
          {shown.length} of {rows.length}
        </span>
      </div>
      {shown.length > 0 && (
        <table className="history-table">
          <thead>
            <tr>
              <th scope="col" className="history-time">
                Time
              </th>
              <th scope="col">What happened</th>
              <th scope="col">
                <span className="visually-hidden">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ event, line, key }) => {
              const expanded = open === key
              const toggle = () => setOpen(expanded ? null : key)
              return (
                <Fragment key={key}>
                  <tr
                    className="clickable"
                    data-story={line.story}
                    data-open={expanded || undefined}
                    onClick={toggle}
                  >
                    <td className="history-time" title={wall(event.at)}>
                      +{elapsed(event.at - start)}
                    </td>
                    <td>
                      <span className="history-line">
                        <span className="tone" data-tone={line.tone} aria-hidden="true" />
                        <span>
                          {line.step !== undefined && (
                            <>
                              <button
                                type="button"
                                className="link"
                                title="Select this step"
                                onClick={(click) => {
                                  click.stopPropagation()
                                  props.onStep((line.step ?? []).join('/'))
                                }}
                              >
                                {line.step.join(' / ')}
                              </button>{' '}
                            </>
                          )}
                          {line.text}
                          {all && !line.text.startsWith(event.type) && (
                            <code className="history-type">{event.type}</code>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="history-open">
                      <button
                        type="button"
                        className="chevron"
                        aria-expanded={expanded}
                        aria-label={`Event ${event.seq} as JSON`}
                        onClick={(click) => {
                          click.stopPropagation()
                          toggle()
                        }}
                      />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="history-json">
                      <td colSpan={3}>
                        <JsonView value={event} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {shown.length === 0 && (
        <p className="quiet history-empty">
          {rows.length === 0 ? 'No events yet.' : 'No event matches.'}
          {hidden > 0 && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setAll(true)}>
                Show all events ({hidden} more match)
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}
