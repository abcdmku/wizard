import { type ReactElement, useMemo, useState } from 'react'
import type { RunDetail, WizardInfo } from '../wire'
import { Status } from './app'
import { useBackend, useRun } from './backend'
import { clock } from './format'
import { framesOf, Graph } from './graph'
import { History } from './history'
import { JsonView } from './json'
import { Go, useNav } from './nav'
import { PendingList } from './pending'

interface SnapshotLike {
  readonly state: { readonly steps: Readonly<Record<string, unknown>> }
  readonly children: Readonly<Record<string, SnapshotLike | undefined>>
}

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
  const nav = useNav()
  const run = useRun(props.id, props.version)
  const [tab, setTab] = useState<Tab>('history')
  const [selected, setSelected] = useState<string | null>(null)
  const wizard = props.wizards.find((item) => item.name === run?.wizard)

  const frames = useMemo(
    () => (run === null || run === undefined ? undefined : framesOf(run.snapshot, run.phases)),
    [run],
  )

  if (run === undefined) return <p className="quiet">Loading…</p>
  if (run === null || frames === undefined)
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
  const again = async () => {
    const started = await backend.start({
      wizard: run.wizard,
      input: run.input,
      services: run.services,
    })
    if (started.ok && started.id !== undefined) nav.go({ page: 'run', id: started.id })
  }
  const remove = async () => {
    await backend.remove(run.id)
    nav.go({ page: 'wizard', name: run.wizard })
  }
  const tabs: readonly [Tab, string][] = [
    ['history', `History (${run.events.length})`],
    ['step', 'Step'],
    ['data', 'Input and result'],
    ['snapshot', 'Snapshot'],
  ]

  return (
    <>
      <div className="title">
        <h1>
          <Go to={{ page: 'wizard', name: run.wizard }}>{run.wizard}</Go>
        </h1>
        <Status status={run.status} />
        <span className="spacer" />
        {!TERMINAL.has(run.status) && (
          <>
            <button
              type="button"
              title="Disposes the run and resumes it from its snapshot, as a restarted process would."
              onClick={() => void backend.act(run.id, { type: 'restart' })}
            >
              Stop and resume
            </button>
            <button type="button" onClick={() => void backend.act(run.id, { type: 'cancel' })}>
              Cancel
            </button>
          </>
        )}
        <button type="button" onClick={() => void again()}>
          Start again
        </button>
        <button type="button" onClick={() => void remove()}>
          Remove
        </button>
      </div>
      <p className="quiet meta">
        <code>{run.id}</code> · started {clock(run.createdAt)} ·{' '}
        {run.services === 'manual' ? 'you answer service calls' : 'configured services'}
      </p>
      {run.stale && (
        <p className="warning">
          The wizard changed after this run started. This run keeps the old definition. Start again
          to use the new one.
        </p>
      )}

      <div className="split">
        {wizard !== undefined && (
          <section className="card graph" aria-label="Steps">
            <Graph
              manifest={wizard.manifest}
              frames={frames}
              selected={selected}
              onSelect={(key) => select(selected === key ? null : key)}
            />
          </section>
        )}
        <div className="stack">
          {run.pending.length > 0 || run.nextTimer !== undefined ? (
            <>
              <h2 className="section">Waiting for you</h2>
              <PendingList run={run} />
            </>
          ) : (
            !TERMINAL.has(run.status) && (
              <p className="quiet">Nothing is waiting for you. The run is working.</p>
            )
          )}
          {run.result !== undefined && (
            <section className="card result" data-status={run.result.status}>
              <h2>Result</h2>
              <JsonView value={run.result} />
            </section>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="card">
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
      </section>
    </>
  )
}
