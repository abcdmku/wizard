/**
 * The four tabs of the `<Devtools>` panel, each a thin composition of one component over the
 * shell's shared state (selection, selected seq, time-travel state, buffers).
 */

import type { RunEvent } from '@openwizard/core'
import { type FlowGraph as FlowGraphData, traceLine } from '@openwizard/core/inspect'
import { type ChangeEvent, type ReactElement, useMemo } from 'react'
import { EventLog } from '../events/EventLog'
import { FlowGraph } from '../graph/FlowGraph'
import { definitionPath, instanceGraph } from '../graph/instances'
import { StepInspector } from '../inspector/StepInspector'
import { collectStatuses } from '../status'
import type { ReplayState, ReplayWindowStore } from '../timeline/replay-window'
import { Timeline } from '../timeline/Timeline'
import {
  type DevtoolsSource,
  type GraphSelection,
  isRunSource,
  type RunSource,
  type StepStatusMap,
  stepKey,
} from '../types'

export interface Shared {
  readonly source: DevtoolsSource
  readonly graph: FlowGraphData | undefined
  readonly selection: GraphSelection | null
  readonly setSelection: (selection: GraphSelection | null) => void
  readonly selectedSeq: number | null
  readonly setSelectedSeq: (seq: number | null) => void
  /** The replayed state while the timeline is scrubbing (`null` = live). */
  readonly travel: ReplayState | null
  readonly setTravel: (state: ReplayState | null, seq: number) => void
  readonly live: {
    readonly statuses: StepStatusMap
    readonly current: string | null
    readonly childPaths: readonly (readonly string[])[]
  }
}

export function GraphTab({ shared }: { readonly shared: Shared }): ReactElement {
  const overlay = useMemo(
    () =>
      shared.travel === null
        ? shared.live
        : collectStatuses({ state: shared.travel, children: {} }),
    [shared.travel, shared.live],
  )
  if (shared.graph === undefined) {
    return (
      <Note>
        no graph to draw — pass `flow` (or `graph`, from inspect(flow)) to the panel; a run source
        brings its own.
      </Note>
    )
  }
  return (
    <FlowGraph
      graph={shared.graph}
      statuses={overlay.statuses}
      childPaths={overlay.childPaths}
      activeStep={overlay.current}
      selected={shared.selection?.key ?? null}
      onSelect={shared.setSelection}
      className="owd-tab-graph"
    />
  )
}

export function EventsTab({
  shared,
  events,
}: {
  readonly shared: Shared
  readonly events: readonly RunEvent[] | undefined
}): ReactElement {
  if (events === undefined)
    return <Note>the event log needs a run source (a Mirror only receives frames).</Note>
  return (
    <EventLog
      events={events}
      selectedSeq={shared.selectedSeq}
      onSelect={(event) => {
        shared.setSelectedSeq(event.seq)
        const { step } = traceLine(event)
        if (step !== '')
          shared.setSelection({ id: step, path: event.path, key: stepKey(event.path, step) })
      }}
    />
  )
}

export function InspectorTab({ shared }: { readonly shared: Shared }): ReactElement {
  const ids = useMemo(
    () =>
      (shared.graph === undefined ? [] : instanceGraph(shared.graph, shared.live.childPaths).nodes)
        .filter(
          (n) => shared.graph !== undefined && definitionPath(shared.graph, n.path) !== undefined,
        )
        .map((n) => ({
          key: stepKey(n.path, n.id),
          id: n.id,
          path: n.path,
        })),
    [shared.graph, shared.live.childPaths],
  )
  const picked = shared.selection
  return (
    <div className="owd-tab-inspector">
      <div className="owd-picker">
        <label className="owd-subtle" htmlFor="owd-step-picker">
          step
        </label>
        <select
          id="owd-step-picker"
          className="owd-select"
          value={picked?.key ?? ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            const found = ids.find((s) => s.key === e.target.value)
            shared.setSelection(found === undefined ? null : found)
          }}
        >
          <option value="">— pick a step (or click one in the graph) —</option>
          {ids.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key}
            </option>
          ))}
        </select>
      </div>
      {picked === null ? (
        <Note>select a step to inspect its record, `explain()` and definition.</Note>
      ) : (
        <StepInspector
          source={shared.source}
          step={picked.id}
          path={picked.path}
          {...(shared.graph === undefined ? {} : { graph: shared.graph })}
        />
      )}
    </div>
  )
}

export function TimelineTab({
  shared,
  store,
  context,
}: {
  readonly shared: Shared
  readonly store: ReplayWindowStore | undefined
  readonly context: unknown
}): ReactElement {
  if (!isRunSource(shared.source) || store === undefined) {
    return <Note>the timeline replays a run's events — a Mirror source has none.</Note>
  }
  const run: RunSource = shared.source
  return <Timeline source={run} store={store} context={context} onScrub={shared.setTravel} />
}

function Note({ children }: { readonly children: string }): ReactElement {
  return <div className="owd-empty owd-note-tab">{children}</div>
}
