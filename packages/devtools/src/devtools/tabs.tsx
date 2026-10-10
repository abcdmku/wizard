/**
 * The four tabs of the `<Devtools>` panel, each a thin composition of one component over the
 * shell's shared state (selection, selected seq, time-travel state, buffers).
 */

import type { FlowGraph as FlowGraphData, WizardEvent } from '@openwizard/core'
import { type ChangeEvent, type ReactElement, useMemo } from 'react'
import { EventLog } from '../events/EventLog'
import { FlowGraph } from '../graph/FlowGraph'
import { StepInspector } from '../inspector/StepInspector'
import { collectStatuses } from '../status'
import type { ReplayState, ReplayWindowStore } from '../timeline/replay-window'
import { Timeline } from '../timeline/Timeline'
import {
  type DevtoolsSource,
  type GraphSelection,
  isWizardSource,
  type StepStatusMap,
  stepKey,
  type WizardSource,
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
  readonly live: { readonly statuses: StepStatusMap; readonly current: string | null }
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
        no graph to draw — pass `flow` (or `graph`, from inspect(flow)) to the panel; a wizard
        source brings its own.
      </Note>
    )
  }
  return (
    <FlowGraph
      graph={shared.graph}
      statuses={overlay.statuses}
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
  readonly events: readonly WizardEvent[] | undefined
}): ReactElement {
  if (events === undefined)
    return <Note>the event log needs a wizard source (a Mirror only receives frames).</Note>
  return (
    <EventLog
      events={events}
      selectedSeq={shared.selectedSeq}
      onSelect={(event) => {
        shared.setSelectedSeq(event.seq)
        const step = (event as { readonly step?: string }).step
        if (typeof step === 'string')
          shared.setSelection({ id: step, path: event.path, key: stepKey(event.path, step) })
      }}
    />
  )
}

export function InspectorTab({ shared }: { readonly shared: Shared }): ReactElement {
  const ids = useMemo(
    () =>
      (shared.graph?.nodes ?? []).map((n) => ({
        key: stepKey(n.path, n.id),
        id: n.id,
        path: n.path,
      })),
    [shared.graph],
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
  if (!isWizardSource(shared.source) || store === undefined) {
    return <Note>the timeline replays a wizard's events — a Mirror source has none.</Note>
  }
  const wizard: WizardSource = shared.source
  return <Timeline source={wizard} store={store} context={context} onScrub={shared.setTravel} />
}

function Note({ children }: { readonly children: string }): ReactElement {
  return <div className="owd-empty owd-note-tab">{children}</div>
}
