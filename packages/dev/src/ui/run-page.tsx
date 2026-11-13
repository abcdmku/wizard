import {
  collectStatuses,
  type SnapshotLike,
  type StepPhase,
  stepKey,
  WizardGraph,
} from '@openwizard/devtools'
import { type ReactElement, useMemo, useState } from 'react'
import type { RunDetail, WizardInfo } from '../wire'
import { useBackend, useRun } from './backend'
import { History } from './history'
import { JsonView } from './json'
import { PendingList } from './pending'
import { RunOutcome } from './result'
import { RunHeader } from './run-header'
import { useScheme } from './scheme'
import { Tabs } from './tabs'

type Tab = 'history' | 'step' | 'data' | 'snapshot'
const TERMINAL = new Set(['done', 'failed', 'cancelled'])

/** The stored record of a step, found by its key in the snapshot of the run or of a child. */
function recordOf(snapshot: SnapshotLike, key: string): unknown {
  const parts = key.split('/')
  const id = parts.pop() as string
  let node: SnapshotLike | undefined = snapshot
  for (let index = 0; index < parts.length && node !== undefined; index++) {
    const step = parts[index] as string
    const next: string | undefined = parts[index + 1]
    const mapped: string | undefined = Object.keys(node.children).find((address) =>
      address.includes(`/${encodeURIComponent(step)}/${next}/`),
    )
    if (node.children[step] === undefined && mapped !== undefined) {
      node = node.children[mapped]
      index += 1
    } else node = node.children[step]
  }
  return node?.state.steps[id]
}

function StepPanel({ run, selected }: { run: RunDetail; selected: string | null }): ReactElement {
  if (selected === null)
    return <p className="quiet">Click a step in the graph or in the history.</p>
  const record = recordOf(run.snapshot as SnapshotLike, selected)
  return (
    <div className="stack">
      <h3>
        <code>{selected.replaceAll('/', ' / ')}</code>
        {run.phases[selected] !== undefined && (
          <span className="quiet"> {run.phases[selected]}</span>
        )}
      </h3>
      {record === undefined ? (
        <p className="quiet">This step has no stored state.</p>
      ) : (
        <JsonView value={record} />
      )}
    </div>
  )
}

/** One run: what it waits for, its live graph, its history and its data. */
export function RunPage(props: {
  readonly id: string
  readonly version: number
  readonly wizards: readonly WizardInfo[]
}): ReactElement {
  const backend = useBackend()
  const scheme = useScheme()
  const run = useRun(props.id, props.version)
  const [tab, setTab] = useState<Tab>('history')
  const [selected, setSelected] = useState<string | null>(null)
  const wizard = props.wizards.find((item) => item.name === run?.wizard)

  const overlay = useMemo(() => {
    if (run === null || run === undefined) return undefined
    const phases = run.phases
    return collectStatuses(run.snapshot as SnapshotLike, (path, id) =>
      path.length === 0 ? (phases[stepKey(path, id)] as StepPhase | undefined) : undefined,
    )
  }, [run])

  if (run === undefined) return <p className="quiet">Loading…</p>
  if (run === null || overlay === undefined)
    return (
      <p className="quiet">
        This run is gone. Runs live in memory and end when the{' '}
        {backend.place === 'server' ? 'dev server restarts' : 'page reloads'}.
      </p>
    )

  const select = (key: string | null) => {
    setSelected(key)
    if (key !== null) setTab('step')
  }
  return (
    <>
      <RunHeader run={run} />
      {run.stale && (
        <p className="warning">
          The wizard changed after this run started. This run keeps the old definition. Start again
          to use the new one.
        </p>
      )}

      {wizard !== undefined && (
        <section className="card graph" aria-label="Steps">
          <WizardGraph
            graph={wizard.manifest}
            statuses={overlay.statuses}
            childPaths={overlay.childPaths}
            activeStep={overlay.current}
            selected={selected}
            onSelect={(selection) => select(selection?.key ?? null)}
            minimap={false}
            follow
            theme={scheme}
          />
        </section>
      )}

      {!TERMINAL.has(run.status) && <PendingList run={run} />}
      <RunOutcome run={run} />

      <Tabs
        label="Run details"
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'history', label: 'History', count: run.events.length },
          { id: 'step', label: 'Step' },
          { id: 'data', label: 'Input and result' },
          { id: 'snapshot', label: 'Snapshot' },
        ]}
      >
        {tab === 'history' && <History events={run.events} onStep={select} />}
        {tab === 'step' && <StepPanel run={run} selected={selected} />}
        {tab === 'data' && (
          <div className="stack">
            <h3>Input</h3>
            <JsonView value={run.input} />
            <h3>Result</h3>
            {run.result === undefined ? (
              <p className="quiet">The run has not finished.</p>
            ) : (
              <JsonView value={run.result} />
            )}
          </div>
        )}
        {tab === 'snapshot' && <JsonView value={run.snapshot} />}
      </Tabs>
    </>
  )
}
