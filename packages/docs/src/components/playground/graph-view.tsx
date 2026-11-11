import type { AnyWizardDefinition, Run, Snapshot } from '@openwizard/core'
import { inspect, type Manifest } from '@openwizard/core/inspect'
import { useMemo } from 'react'
import { runAt } from './child-path'
import { type NodeStateLookup, WizardGraphView } from './wizard-graph'

export interface StepRef {
  readonly path: readonly string[]
  readonly id: string
}

/** The selected child's snapshot, using public owner/index paths rather than storage keys. */
export function snapshotAt(
  run: Run<AnyWizardDefinition>,
  path: readonly string[],
): Snapshot<AnyWizardDefinition> | undefined {
  try {
    return runAt(run, path).getSnapshot()
  } catch {
    return undefined
  }
}

/** Live status / phase per node: the root from `getState()` + `explain()`, children from their snapshots. */
function liveStateLookup(run: Run<AnyWizardDefinition>): NodeStateLookup {
  return (path, id) => {
    if (path.length === 0) {
      const record = run.getState().steps[id]
      if (!record) return undefined
      const explanation = run.explain(id)
      return explanation.phase === undefined
        ? { status: record.status }
        : { status: record.status, phase: explanation.phase }
    }
    const record = snapshotAt(run, path)?.state.steps[id]
    return record ? { status: record.status } : undefined
  }
}

export function safeInspect(wizard: AnyWizardDefinition): Manifest | { readonly error: string } {
  try {
    return inspect(wizard)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

interface GraphViewProps {
  readonly wizard: AnyWizardDefinition | undefined
  readonly run: Run<AnyWizardDefinition> | undefined
  readonly selected: StepRef | null
  readonly onSelect: (ref: StepRef) => void
}

/** The Graph tab: `inspect(wizard)` as a wizard graph, nodes coloured by the live run state. */
export function GraphView({ wizard, run, selected, onSelect }: GraphViewProps) {
  const graph = useMemo(() => (wizard ? safeInspect(wizard) : null), [wizard])
  // The parent re-renders on every batch of events, so the lookup reads fresh statuses each time.
  const liveState = run ? liveStateLookup(run) : undefined
  if (!graph) {
    return (
      <p className="p-4 font-mono text-xs text-neutral-500">
        Run code that creates a run or exports a wizard. Its <code>inspect(wizard)</code> graph
        appears here.
      </p>
    )
  }
  if ('error' in graph) {
    return <p className="p-4 font-mono text-xs text-neutral-500">inspect() failed: {graph.error}</p>
  }
  return (
    <div className="p-4">
      <WizardGraphView
        graph={graph}
        liveState={liveState}
        selected={selected}
        onSelect={(path, id) => onSelect({ path, id })}
      />
    </div>
  )
}
