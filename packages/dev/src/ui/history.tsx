import type { AnyWizardDefinition, RunEvent } from '@openwizard/core'
import { Fragment, type ReactElement, useState } from 'react'
import { brief, clock } from './format'
import { JsonView } from './json'

type Loose = {
  readonly seq: number
  readonly at: number
  readonly type: string
  readonly path?: readonly string[]
  readonly step?: string
} & Readonly<Record<string, unknown>>

/** The events of a run, oldest first. A row opens to the whole event. */
export function History(props: {
  readonly events: readonly RunEvent<AnyWizardDefinition>[]
  readonly onStep: (key: string) => void
}): ReactElement {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const rows = (props.events as unknown as readonly Loose[]).filter(
    (event) => needle === '' || JSON.stringify(event).toLowerCase().includes(needle),
  )
  return (
    <>
      <input
        className="filter"
        placeholder="Filter events"
        aria-label="Filter events"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <table className="history">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Event</th>
            <th>Step</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event, index) => {
            const { seq, at, type, path, step, ...rest } = event
            const where = [...(path ?? []), ...(step === undefined ? [] : [step])]
            // A child event repeats the seq of its own run, so the row needs more than seq.
            const key = `${index}:${seq}:${type}`
            return (
              <Fragment key={key}>
                <tr
                  className="clickable"
                  data-family={type.split('.')[0]}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  <td>{seq}</td>
                  <td>{clock(at)}</td>
                  <td>
                    <span className="event">{type}</span>
                  </td>
                  <td>
                    {where.length > 0 && (
                      <button
                        type="button"
                        className="link"
                        onClick={(click) => {
                          click.stopPropagation()
                          props.onStep(where.join('/'))
                        }}
                      >
                        {where.join(' / ')}
                      </button>
                    )}
                  </td>
                  <td className="quiet detail">
                    {Object.keys(rest).length > 0 && brief(rest, 110)}
                  </td>
                </tr>
                {open === key && (
                  <tr>
                    <td colSpan={5}>
                      <JsonView value={event} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="quiet">No event matches.</p>}
    </>
  )
}
