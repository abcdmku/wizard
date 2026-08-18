import { type AnyFlow, type FlowGraph, inspect, type Snapshot, type Wizard } from '@openwizard/core'
import { useMemo } from 'react'
import { FlowGraphView, type NodeStateLookup } from './flow-graph'

export interface StepRef {
  readonly path: readonly string[]
  readonly id: string
}

/** The snapshot of the (child) wizard at `path`, walking `Snapshot.children`. */
export function snapshotAt(
  wizard: Wizard<AnyFlow>,
  path: readonly string[],
): Snapshot<AnyFlow> | undefined {
  let snapshot: Snapshot<AnyFlow> | undefined = wizard.getSnapshot()
  for (const step of path) {
    const children: Readonly<Record<string, Snapshot<AnyFlow> | undefined>> =
      snapshot?.children ?? {}
    snapshot = children[step]
  }
  return snapshot
}

/** Live status / phase per node: the root from `getState()` + `explain()`, children from their snapshots. */
export function liveStateLookup(wizard: Wizard<AnyFlow>): NodeStateLookup {
  return (path, id) => {
    if (path.length === 0) {
      const record = wizard.getState().steps[id]
      if (!record) return undefined
      const explanation = wizard.explain(id)
      return explanation.phase === undefined
        ? { status: record.status }
        : { status: record.status, phase: explanation.phase }
    }
    const record = snapshotAt(wizard, path)?.state.steps[id]
    return record ? { status: record.status } : undefined
  }
}

export function safeInspect(flow: AnyFlow): FlowGraph | { readonly error: string } {
  try {
    return inspect(flow)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

interface GraphViewProps {
  readonly flow: AnyFlow | undefined
  readonly wizard: Wizard<AnyFlow> | undefined
  readonly selected: StepRef | null
  readonly onSelect: (ref: StepRef) => void
}

/** The Graph tab: `inspect(flow)` as a DAG, nodes coloured by the live wizard state. */
export function GraphView({ flow, wizard, selected, onSelect }: GraphViewProps) {
  const graph = useMemo(() => (flow ? safeInspect(flow) : null), [flow])
  // The parent re-renders on every batch of events, so the lookup reads fresh statuses each time.
  const liveState = wizard ? liveStateLookup(wizard) : undefined
  if (!graph) {
    return (
      <p className="p-4 font-mono text-xs text-neutral-500">
        Run the code — the graph is <code>inspect(flow)</code> of the wizard it creates (or of an
        exported flow).
      </p>
    )
  }
  if ('error' in graph) {
    return <p className="p-4 font-mono text-xs text-neutral-500">inspect() failed: {graph.error}</p>
  }
  return (
    <div className="p-4">
      <FlowGraphView
        graph={graph}
        liveState={liveState}
        selected={selected}
        onSelect={(path, id) => onSelect({ path, id })}
      />
    </div>
  )
}
