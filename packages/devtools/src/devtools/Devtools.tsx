/**
 * `<Devtools>` — the dockable panel: Graph / Events / Inspector / Timeline tabs over one source,
 * docked at the bottom or on the right, resizable, toggled by a button or `ctrl+shift+d`.
 * The event buffer and the replay window live in the shell, so nothing is lost while the panel
 * is closed or another tab is showing.
 */

import { type FlowGraph as FlowGraphData, inspect } from '@openwizard/core'
import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { useBufferedEvents, useEventBuffer } from '../events/event-buffer'
import { useSourceOverlay, useSourceSnapshot } from '../hooks/use-source'
import { type ReplayState, useReplayWindow } from '../timeline/replay-window'
import {
  type DevtoolsSource,
  type DevtoolsTheme,
  type GraphInput,
  type GraphSelection,
  isProjectedState,
  isWizardSource,
} from '../types'
import { EventsTab, GraphTab, InspectorTab, type Shared, TimelineTab } from './tabs'
import { useHotkey } from './use-hotkey'
import { type DockPosition, useResize } from './use-resize'

/**
 * `<Devtools>` props: the `source` (a `Wizard` or a `Mirror`), the graph (`flow` / `graph`; a
 * wizard source brings its own flow), `theme`, `defaultOpen`, dock `position` and `defaultSize`
 * (px), the toggle `hotkey` (default `ctrl+shift+d`, `false` to disable), `context` (the input
 * `createWizard` received) for a full-range timeline, `maxEvents` for the event buffer.
 * @public
 */
export interface DevtoolsProps extends GraphInput {
  readonly source: DevtoolsSource
  readonly theme?: DevtoolsTheme
  readonly defaultOpen?: boolean
  readonly position?: DockPosition
  readonly defaultSize?: number
  readonly hotkey?: string | false
  readonly context?: unknown
  readonly maxEvents?: number
  readonly title?: string
}

type Tab = 'graph' | 'events' | 'inspector' | 'timeline'
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['graph', 'Graph'],
  ['events', 'Events'],
  ['inspector', 'Inspector'],
  ['timeline', 'Timeline'],
]

/**
 * The composite devtools panel: the flow graph with the live overlay (and the time-travelled
 * state while the timeline scrubs), the event log, the step inspector and the timeline, in a
 * dockable, resizable panel. Works over a `Mirror` too (graph + inspector from the projected
 * state; the events and the timeline need a wizard and say so).
 * @public
 */
export function Devtools(props: DevtoolsProps): ReactElement {
  const { source } = props
  const wizard = isWizardSource(source) ? source : undefined
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const [tab, setTab] = useState<Tab>('graph')
  const [position, setPosition] = useState<DockPosition>(props.position ?? 'bottom')
  const toggle = useCallback(() => setOpen((v) => !v), [])
  useHotkey(props.hotkey ?? 'ctrl+shift+d', toggle)
  const { size, onHandlePointerDown } = useResize(
    position,
    props.defaultSize ?? (position === 'bottom' ? 360 : 520),
  )

  const graph: FlowGraphData | undefined = useMemo(() => {
    if (props.graph !== undefined) return props.graph
    const flow = props.flow ?? wizard?.flow
    return flow === undefined ? undefined : inspect(flow)
  }, [props.graph, props.flow, wizard])

  // Buffers live here so closing the panel / switching tabs loses nothing.
  const buffer = useEventBuffer(wizard, props.maxEvents)
  const events = useBufferedEvents(buffer)
  const window = useReplayWindow(wizard, { context: props.context })

  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [travel, setTravel] = useState<ReplayState | null>(null)
  const live = useSourceOverlay(source)
  const shared: Shared = {
    source,
    graph,
    selection,
    setSelection,
    selectedSeq,
    setSelectedSeq,
    travel,
    setTravel,
    live,
  }

  const theme = props.theme ?? 'system'
  const themeAttr = theme === 'system' ? undefined : theme
  if (!open) {
    return (
      <div className="owd owd-devtools" data-theme={themeAttr}>
        <button
          type="button"
          className="owd-fab"
          onClick={toggle}
          title="OpenWizard devtools (ctrl+shift+d)"
        >
          <span className="owd-fab-dot" data-status={statusOf(source)} />
          {props.title ?? 'OpenWizard'}
        </button>
      </div>
    )
  }
  return (
    <div className="owd owd-devtools" data-theme={themeAttr} data-position={position}>
      <div className="owd-panel" style={position === 'bottom' ? { height: size } : { width: size }}>
        <div className="owd-resize-handle" onPointerDown={onHandlePointerDown} aria-hidden="true" />
        <div className="owd-panel-bar">
          <span className="owd-title">{props.title ?? 'OpenWizard'}</span>
          <nav className="owd-tabs" aria-label="devtools tabs">
            {TABS.map(([id, label]) => (
              <button
                type="button"
                key={id}
                className="owd-tab"
                data-active={tab === id ? 'true' : undefined}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
              >
                {label}
                {id === 'events' && events.length > 0 && (
                  <span className="owd-count">{events.length}</span>
                )}
                {id === 'timeline' && travel !== null && (
                  <span className="owd-count owd-count-warn">⏪</span>
                )}
              </button>
            ))}
          </nav>
          <SourceMeta source={source} />
          <button
            type="button"
            className="owd-btn owd-btn-icon"
            onClick={() => setPosition(position === 'bottom' ? 'right' : 'bottom')}
            title="dock right / bottom"
          >
            {position === 'bottom' ? '▕' : '▁'}
          </button>
          <button
            type="button"
            className="owd-btn owd-btn-icon"
            onClick={toggle}
            title="close (ctrl+shift+d)"
            aria-label="close devtools"
          >
            ×
          </button>
        </div>
        <div className="owd-panel-body">
          <div className="owd-tab-pane" hidden={tab !== 'graph'}>
            <GraphTab shared={shared} />
          </div>
          <div className="owd-tab-pane" hidden={tab !== 'events'}>
            <EventsTab shared={shared} events={wizard === undefined ? undefined : events} />
          </div>
          <div className="owd-tab-pane" hidden={tab !== 'inspector'}>
            <InspectorTab shared={shared} />
          </div>
          <div className="owd-tab-pane" hidden={tab !== 'timeline'}>
            <TimelineTab shared={shared} store={window} context={props.context} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Status / seq / instance of the source, live. */
function SourceMeta({ source }: { readonly source: DevtoolsSource }): ReactElement {
  const snapshot = useSourceSnapshot(source)
  if (isWizardSource(source)) {
    const state = source.getState()
    return (
      <span className="owd-panel-meta owd-mono">
        <span className="owd-status-dot" data-status={state.status} /> {state.status} · seq{' '}
        {state.seq} · {source.id}
      </span>
    )
  }
  const projected = isProjectedState(snapshot) ? snapshot : undefined
  return (
    <span className="owd-panel-meta owd-mono">
      mirror · {projected?.status ?? (source.connected ? 'connected' : 'no frame')} · seq{' '}
      {source.seq ?? '—'} · {source.instanceId ?? '—'}
    </span>
  )
}

function statusOf(source: DevtoolsSource): string {
  if (isWizardSource(source)) return source.getState().status
  const projected = source.getSnapshot()
  return isProjectedState(projected) ? projected.status : 'idle'
}
