import {
  collectStatuses,
  type SnapshotLike,
  type StepPhase,
  stepKey,
  WizardGraph,
} from '@openwizard/devtools'
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import type { RunDetail, WizardInfo } from '../wire'
import { useBackend, useRun } from './backend'
import { History } from './history'
import { CopyJson, JsonView } from './json'
import { PendingList } from './pending'
import { RunOutcome } from './result'
import { RunHeader } from './run-header'
import { useScheme, useScroll } from './scheme'
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

/** From this width the graph and the run's cards sit side by side. */
const WIDE = 940

/** A ref for the element to measure, and true while it is at least `WIDE` pixels across. */
function useWide(): [(element: HTMLDivElement | null) => void, boolean] {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (box === null || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => setWide(box.clientWidth >= WIDE))
    watch.observe(box)
    return () => watch.disconnect()
  }, [box])
  return [setBox, wide]
}

/**
 * One run: its header, its live graph, the chosen step's details, what it waits for, how it
 * ended, and its history and data. In a wide frame the graph stays on the left and the rest
 * scrolls beside it. In a narrow one they stack.
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
  const [cols, wide] = useWide()
  // Stacked in a page, the graph stays in view above the cards, so it keeps to a short pane.
  const pinned = useScroll() === 'page' && !wide

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

      <div ref={cols} className="run-cols" data-wide={wide || undefined}>
        <div className="run-graph">
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
                autoHeight={wide ? { min: 220, max: 720 } : { min: 120, max: pinned ? 340 : 480 }}
                attribution={false}
                wheelZoom={false}
                theme={scheme}
              />
            </section>
          )}
        </div>
        <div className="run-detail">
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
            {tab === 'history' && (
              <History events={run.events} onStep={(key) => setSelected(key)} />
            )}
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
                    The whole run as JSON. A store keeps this, and resuming from it continues the
                    run.
                  </p>
                  <CopyJson value={run.snapshot} />
                </div>
                <JsonView value={run.snapshot} />
              </div>
            )}
          </Tabs>
        </div>
      </div>
    </>
  )
}
