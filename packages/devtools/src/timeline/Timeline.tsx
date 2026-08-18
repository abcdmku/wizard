/**
 * `<Timeline>` — a seq scrubber over the replay window of a wizard: pick a seq, see the state
 * the machine had right after that event (`replay(flow, events, { from, upTo })` — read-only,
 * nothing runs), step back and forth, or follow the live end.
 */

import type { WizardEvent } from '@openwizard/core'
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { eventDetail, eventStep } from '../events/format'
import type { DevtoolsTheme, WizardSource } from '../types'
import {
  type ReplayState,
  type ReplayWindowStore,
  stateAt,
  useReplayWindow,
  useWindowSnapshot,
} from './replay-window'

/**
 * `<Timeline>` props: the wizard `source`; `context` (the input `createWizard` received) lets the
 * window start from the initial state when the whole log is still available, else scrubbing
 * starts where the timeline attached; `onScrub` receives the replayed state (or `null` when
 * following the live end); `maxEvents` bounds the window (default 5000).
 * @public
 */
export interface TimelineProps {
  readonly source: WizardSource
  readonly context?: unknown
  readonly onScrub?: (state: ReplayState | null, seq: number) => void
  readonly maxEvents?: number
  /** A shared window (`createReplayWindow`, attached by its owner) — the `<Devtools>` panel passes its own so the range survives closing the panel. */
  readonly store?: ReplayWindowStore
  readonly theme?: DevtoolsTheme
  readonly className?: string
  readonly style?: CSSProperties
}

/**
 * Time travel over a wizard's events: a `seq` slider (and ◀ / ▶ buttons) shows the state at any
 * kept seq — status, current view, active steps, every step's status — and the event that
 * produced it; "live" snaps back to the newest state. Read-only; the range is bounded by what
 * the timeline saw (`log()` at attach time + `observe()` since) and by `maxEvents`.
 * @public
 */
export function Timeline(props: TimelineProps): ReactElement {
  const store = useReplayWindow(props.source, {
    context: props.context,
    ...(props.maxEvents === undefined ? {} : { maxEvents: props.maxEvents }),
    ...(props.store === undefined ? {} : { store: props.store }),
  })
  const window = useWindowSnapshot(store)
  const [pinned, setPinned] = useState<number | null>(null) // null = live
  const seq =
    pinned === null ? window.latest : Math.min(Math.max(pinned, window.base.seq), window.latest)
  const live = pinned === null || seq >= window.latest
  const { source } = props
  const state = useMemo(
    () => (live ? source.getState() : stateAt(window, source.flow, seq)),
    [live, seq, source, window],
  )
  const event = useMemo(() => window.events.find((e) => e.seq === seq), [window, seq])

  const { onScrub } = props
  useEffect(() => {
    onScrub?.(live ? null : state, seq)
  }, [onScrub, live, state, seq])

  const theme = props.theme ?? 'system'
  const step = (delta: number): void =>
    setPinned(Math.min(Math.max(seq + delta, window.base.seq), window.latest))
  return (
    <div
      className={
        props.className === undefined ? 'owd owd-timeline' : `owd owd-timeline ${props.className}`
      }
      data-theme={theme === 'system' ? undefined : theme}
      style={props.style}
    >
      <div className="owd-timeline-bar">
        <button
          type="button"
          className="owd-btn"
          onClick={() => setPinned(window.base.seq)}
          disabled={seq <= window.base.seq}
          aria-label="first"
        >
          ⏮
        </button>
        <button
          type="button"
          className="owd-btn"
          onClick={() => step(-1)}
          disabled={seq <= window.base.seq}
          aria-label="previous"
        >
          ◀
        </button>
        <input
          className="owd-range"
          type="range"
          min={window.base.seq}
          max={window.latest}
          value={seq}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPinned(Number(e.target.value))}
          aria-label="seq"
        />
        <button
          type="button"
          className="owd-btn"
          onClick={() => step(1)}
          disabled={seq >= window.latest}
          aria-label="next"
        >
          ▶
        </button>
        <button
          type="button"
          className="owd-btn"
          data-active={live ? 'true' : undefined}
          onClick={() => setPinned(null)}
          aria-label="live"
        >
          {live ? '● live' : 'live'}
        </button>
        <span className="owd-mono owd-timeline-seq">
          seq {seq} / {window.latest}
        </span>
      </div>
      <StateSummary state={state} event={event} live={live} />
      {window.base.seq > 0 && (
        <div className="owd-note">
          scrubbing starts at seq {window.base.seq} (where the timeline attached; the log is bounded
          by <code>logSize</code>) — mount the devtools before <code>start()</code> or pass{' '}
          <code>context</code> for the full range.
        </div>
      )}
    </div>
  )
}

function StateSummary({
  state,
  event,
  live,
}: {
  readonly state: ReplayState
  readonly event: WizardEvent | undefined
  readonly live: boolean
}): ReactElement {
  const steps = Object.values(state.steps)
  return (
    <div className="owd-timeline-state" data-live={live ? 'true' : undefined}>
      <div className="owd-kv-list">
        <div className="owd-kv">
          <span className="owd-kv-key">status</span>
          <span className="owd-kv-value owd-mono" data-status={state.status}>
            {state.status}
          </span>
        </div>
        <div className="owd-kv">
          <span className="owd-kv-key">current</span>
          <span className="owd-kv-value owd-mono">{state.current ?? '—'}</span>
        </div>
        <div className="owd-kv">
          <span className="owd-kv-key">active</span>
          <span className="owd-kv-value owd-mono">
            {state.active.length === 0 ? '—' : state.active.join(', ')}
          </span>
        </div>
        {event !== undefined && (
          <div className="owd-kv">
            <span className="owd-kv-key">event</span>
            <span className="owd-kv-value owd-mono">
              {event.type} {eventStep(event)}{' '}
              <span className="owd-subtle">{eventDetail(event)}</span>
            </span>
          </div>
        )}
      </div>
      <div className="owd-chips">
        {steps.map((s) => (
          <span
            key={s.id}
            className="owd-chip owd-step-chip"
            data-status={s.status}
            title={`${s.id}: ${s.status}`}
          >
            {s.id}
          </span>
        ))}
      </div>
    </div>
  )
}
