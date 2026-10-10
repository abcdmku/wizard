/**
 * `<EventLog>` — the domain events of a wizard as a table (seq / at / type / step / path /
 * detail), live through `observe()` (seeded with `log()`) or from a static array; filterable,
 * windowed (only the visible rows are in the DOM), following the newest row until you scroll up.
 */

import type { WizardEvent } from '@openwizard/core'
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DevtoolsTheme, WizardSource } from '../types'
import { useBufferedEvents, useEventBuffer } from './event-buffer'
import { eventDetail, eventStep, formatAt, matchesFilter } from './format'

/**
 * `<EventLog>` props: a live `source` (wizard) or a static `events` array; an optional `filter`
 * (substring over type / step / event / path, or a predicate); `onSelect` + `selectedSeq` for
 * the row selection; `maxRows` bounds the live buffer (default 2000).
 * @public
 */
export interface EventLogProps {
  readonly source?: WizardSource
  readonly events?: readonly WizardEvent[]
  readonly filter?: string | ((event: WizardEvent) => boolean)
  readonly onSelect?: (event: WizardEvent) => void
  readonly selectedSeq?: number | null
  readonly maxRows?: number
  /** Show the filter box (default `true`). */
  readonly showFilter?: boolean
  readonly theme?: DevtoolsTheme
  readonly className?: string
  readonly style?: CSSProperties
}

const ROW_HEIGHT = 24
const OVERSCAN = 8
const FALLBACK_HEIGHT = 240

/**
 * The event log of a wizard: `seq`, `at`, `type`, `step`, `path` and a one-line detail per event.
 * Live over `source.observe()` (starting from `source.log()`), or the given `events`. Click a
 * row to select it (`onSelect(event)`).
 * @public
 */
export function EventLog(props: EventLogProps): ReactElement {
  const rows = useLogRows(props)
  const [text, setText] = useState('')
  const filtered = useMemo(() => {
    const own = text.trim() === '' ? undefined : text
    const external = props.filter
    return rows.filter((event) => {
      if (own !== undefined && !matchesFilter(event, own)) return false
      if (external === undefined) return true
      return typeof external === 'string' ? matchesFilter(event, external) : external(event)
    })
  }, [rows, text, props.filter])
  const origin = rows[0]?.at
  const theme = props.theme ?? 'system'
  return (
    <div
      className={props.className === undefined ? 'owd owd-log' : `owd owd-log ${props.className}`}
      data-theme={theme === 'system' ? undefined : theme}
      style={props.style}
    >
      {props.showFilter !== false && (
        <div className="owd-log-bar">
          <input
            className="owd-input"
            type="search"
            placeholder="filter events (type, step, event, path)"
            value={text}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
            aria-label="filter events"
          />
          <span className="owd-subtle">
            {filtered.length === rows.length
              ? `${rows.length} events`
              : `${filtered.length} / ${rows.length}`}
          </span>
        </div>
      )}
      <Rows
        events={filtered}
        origin={origin}
        selectedSeq={props.selectedSeq ?? null}
        onSelect={props.onSelect}
      />
    </div>
  )
}

/** Static `events` win; otherwise the live buffer of `source` (empty without either). */
function useLogRows(props: EventLogProps): readonly WizardEvent[] {
  const live = useEventBuffer(props.events === undefined ? props.source : undefined, props.maxRows)
  const buffered = useBufferedEvents(live)
  return props.events ?? buffered
}

interface RowsProps {
  readonly events: readonly WizardEvent[]
  readonly origin: number | undefined
  readonly selectedSeq: number | null
  readonly onSelect: ((event: WizardEvent) => void) | undefined
}

/** The windowed table: fixed row height, only the visible slice (+ overscan) is rendered. */
function Rows({ events, origin, selectedSeq, onSelect }: RowsProps): ReactElement {
  const viewport = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(FALLBACK_HEIGHT)
  const [follow, setFollow] = useState(true)
  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    setHeight(el.clientHeight || FALLBACK_HEIGHT)
    setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT)
  }, [])
  // Follow the newest row while the user is at the bottom.
  useEffect(() => {
    const el = viewport.current
    if (el !== null && follow && events.length > 0) el.scrollTop = el.scrollHeight
  }, [events, follow])
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(events.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const visible = events.slice(start, end)
  return (
    <div className="owd-log-viewport" ref={viewport} onScroll={onScroll}>
      <div className="owd-log-head">
        <span>seq</span>
        <span>at</span>
        <span>type</span>
        <span>step</span>
        <span>path</span>
        <span>detail</span>
      </div>
      <div style={{ height: start * ROW_HEIGHT }} />
      {visible.map((event) => (
        <button
          type="button"
          key={`${event.path.join('/')}:${event.seq}:${event.type}`}
          className="owd-log-row"
          data-selected={event.seq === selectedSeq && event.path.length === 0 ? 'true' : undefined}
          data-child={event.path.length > 0 ? 'true' : undefined}
          onClick={() => onSelect?.(event)}
          style={{ height: ROW_HEIGHT }}
        >
          <span className="owd-mono">{event.seq}</span>
          <span className="owd-mono owd-subtle">{formatAt(event.at, origin)}</span>
          <span className="owd-log-type" data-family={event.type.split('.')[0]}>
            {event.type}
          </span>
          <span className="owd-mono">{eventStep(event)}</span>
          <span className="owd-mono owd-subtle">{event.path.join('/')}</span>
          <span className="owd-log-detail owd-subtle" title={eventDetail(event)}>
            {eventDetail(event)}
          </span>
        </button>
      ))}
      <div style={{ height: Math.max(0, events.length - end) * ROW_HEIGHT }} />
      {events.length === 0 && <div className="owd-empty">no events yet</div>}
    </div>
  )
}
