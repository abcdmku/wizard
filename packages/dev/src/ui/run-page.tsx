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
import { CopyJson, JsonView } from './json'
import { PendingList } from './pending'
import { RunOutcome } from './result'
import { RunHeader } from './run-header'
import { useScheme } from './scheme'
import { attentionOf } from './status-word'
import { StepPanel } from './step-panel'
import { Tabs } from './tabs'

type Tab = 'history' | 'data' | 'snapshot'
const TERMINAL = new Set(['done', 'failed', 'cancelled'])
/** Every status after which the run does nothing more. */
const ENDED = new Set([...TERMINAL, 'compensated'])

/**
 * The steps whose undo hook made a call that waits for an answer. The graph rings them. A run
 * that has ended rings nothing.
 */
const undoCallers = (run: RunDetail): readonly string[] =>
  ENDED.has(run.status)
    ? []
    : run.pending.flatMap((item) =>
        item.kind === 'call' && item.undo === true && item.step !== undefined
          ? [[...(item.path ?? []), item.step].join('/')]
          : [],
      )

/**
 * One run: its header, its live graph with the chosen step's details right under it, what it
 * waits for, how it ended, and its history and data.
 */
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
  const attention = useMemo(
    () => (run === null || run === undefined ? [] : [...attentionOf(run), ...undoCallers(run)]),
    [run],
  )

  if (run === undefined) return <p className="quiet">Loading…</p>
  if (run === null || overlay === undefined)
    return (
      <p className="quiet">
        This run is gone. Runs live in memory and end when the{' '}
        {backend.place === 'server' ? 'dev server restarts' : 'page reloads'}.
      </p>
    )

  // Choosing the step that is already open closes it.
  const select = (key: string | null) => setSelected((open) => (key === open ? null : key))
  return (
    <>
      <RunHeader run={run} />
      {run.stale && (
        <p className="warning">
          The wizard changed after this run started. This run keeps the old definition. Start a new
          run to use the new one.
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
            attention={attention}
            minimap={false}
            follow
            ended={TERMINAL.has(run.status)}
            runStatus={run.status}
            autoHeight={{ min: 120, max: 480 }}
            attribution={false}
            wheelZoom={false}
            theme={scheme}
          />
        </section>
      )}
      {selected !== null && (
        <StepPanel
          run={run}
          wizard={wizard}
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {!TERMINAL.has(run.status) && <PendingList run={run} manifest={wizard?.manifest} />}
      <RunOutcome run={run} />

      <Tabs
        label="Run details"
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'history', label: 'History', count: run.events.length },
          { id: 'data', label: 'Input and result' },
          { id: 'snapshot', label: 'Snapshot' },
        ]}
      >
        {tab === 'history' && <History events={run.events} onStep={(key) => setSelected(key)} />}
        {tab === 'data' && (
          <div className="stack">
            <div className="json-head">
              <h3>Input</h3>
              <CopyJson value={run.input} />
            </div>
            <JsonView value={run.input} />
            <div className="json-head">
              <h3>Result</h3>
              {run.result !== undefined && <CopyJson value={run.result} />}
            </div>
            {run.result === undefined ? (
              <p className="quiet">The run has not finished.</p>
            ) : (
              <JsonView value={run.result} />
            )}
          </div>
        )}
        {tab === 'snapshot' && (
          <div className="stack">
            <div className="json-head">
              <p className="quiet">
                The whole run as JSON. A store keeps this, and resuming from it continues the run.
              </p>
              <CopyJson value={run.snapshot} />
            </div>
            <JsonView value={run.snapshot} />
          </div>
        )}
      </Tabs>
    </>
  )
}
