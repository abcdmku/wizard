/**
 * The page: a few buttons that drive the wizard (start, send the approval, retry a failed task,
 * reset) and a status line — the interesting part is the `<Devtools>` panel docked underneath,
 * fed with the same wizard object (and the context input, so the timeline covers the whole run).
 */
import type { Wizard } from '@openwizard/core'
import { Devtools } from '@openwizard/devtools'
import { useSyncExternalStore } from 'react'
import { context, type pipeline } from './wizard'

const TASKS = ['ingest', 'normalize', 'enrich', 'persist'] as const

export function App({ wizard }: { wizard: Wizard<typeof pipeline> }) {
  const state = useSyncExternalStore(
    (listener) => wizard.subscribe(listener),
    () => wizard.getState(),
    () => wizard.getState(),
  )
  const failed = TASKS.find((id) => state.steps[id].status === 'failed')
  return (
    <main className="page">
      <header>
        <p className="eyebrow">OpenWizard · example 10</p>
        <h1>A DAG pipeline under the devtools</h1>
        <p className="lede">
          Example 07's ingest pipeline (fan-out, retry, AND-join, an approval wait) runs in this
          page. Drive it with the buttons; watch the graph, the events, the inspector and the
          timeline in the panel below (<kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>d</kbd> toggles it).
        </p>
      </header>
      <section className="controls">
        <button
          type="button"
          onClick={() => void wizard.start()}
          disabled={state.status !== 'idle'}
        >
          Start
        </button>
        <button
          type="button"
          onClick={() => void wizard.send('review.approved', { by: 'ada' })}
          disabled={state.steps.approve.status !== 'active'}
        >
          Send review.approved
        </button>
        <button
          type="button"
          onClick={() => {
            if (failed !== undefined) void wizard.retry(failed)
          }}
          disabled={failed === undefined}
        >
          Retry {failed ?? 'failed task'}
        </button>
        <button
          type="button"
          onClick={() => void wizard.reset()}
          disabled={state.status === 'idle'}
        >
          Reset
        </button>
      </section>
      <section className="status" data-status={state.status}>
        <span className="dot" /> status <code>{state.status}</code> · seq <code>{state.seq}</code>
        {state.status === 'waiting' && state.steps.approve.status === 'active' && (
          <span className="hint"> — waiting for the approval event</span>
        )}
        {state.output !== undefined && (
          <span className="hint">
            {' '}
            — output <code>{String(state.output)}</code>
          </span>
        )}
      </section>
      <Devtools source={wizard} context={context} defaultOpen theme="system" />
    </main>
  )
}
