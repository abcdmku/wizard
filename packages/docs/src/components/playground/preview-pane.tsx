import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ExplainView } from './explain-view'
import { GraphView, type StepRef } from './graph-view'
import type { RunnerSnapshot } from './runner'
import { ConsoleView, TraceView } from './trace-view'

type Tab = 'graph' | 'trace' | 'explain' | 'console'
const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: 'graph', label: 'Graph' },
  { id: 'trace', label: 'Trace' },
  { id: 'explain', label: 'Explain' },
  { id: 'console', label: 'Console' },
]

interface PreviewPaneProps {
  readonly snapshot: RunnerSnapshot
  readonly onRun: () => void
  readonly canRun: boolean
}

function StatusLabel({ snapshot }: { readonly snapshot: RunnerSnapshot }) {
  const errors = snapshot.diagnostics.filter((d) => d.category === 'error').length
  const text =
    snapshot.status === 'idle'
      ? 'Ready'
      : snapshot.status === 'compiling'
        ? 'Compiling…'
        : snapshot.status === 'running'
          ? 'Running…'
          : snapshot.status === 'error'
            ? 'Failed'
            : 'Done'
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          snapshot.status === 'running' || snapshot.status === 'compiling'
            ? 'animate-pulse bg-neutral-900 dark:bg-neutral-100'
            : snapshot.status === 'error'
              ? 'bg-neutral-900 dark:bg-neutral-100'
              : 'bg-neutral-400'
        }`}
      />
      {text}
      {errors > 0 && (
        <span title="TypeScript errors (the code still runs, like tsx)">
          · {errors} type error{errors === 1 ? '' : 's'}
        </span>
      )}
    </span>
  )
}

/** Run button, the four preview tabs and the wizard selector; the tabs read the runner snapshot. */
export function PreviewPane({ snapshot, onRun, canRun }: PreviewPaneProps) {
  const [tab, setTab] = useState<Tab>('graph')
  const [selectedWizard, setSelectedWizard] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<StepRef | null>(null)

  const handle =
    snapshot.wizards.find((candidate) => candidate.label === selectedWizard) ??
    snapshot.wizards.at(-1)
  const wizard = handle?.wizard
  const flow = wizard?.flow ?? snapshot.flows[0]

  // A new run replaces the wizards: forget a selection that no longer exists.
  useEffect(() => {
    if (
      selectedWizard &&
      !snapshot.wizards.some((candidate) => candidate.label === selectedWizard)
    ) {
      setSelectedWizard(null)
    }
  }, [snapshot.wizards, selectedWizard])

  const selectStep = (ref: StepRef) => {
    setSelectedStep(ref)
    setTab('explain')
  }

  const errorDiagnostics = snapshot.diagnostics.filter((d) => d.category === 'error')

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-ink">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        <div className="flex items-center gap-1" role="tablist" aria-label="Preview">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                tab === item.id
                  ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
              }`}
            >
              {item.label}
              {item.id === 'trace' && snapshot.trace.length > 0 && (
                <span className="ml-1 text-neutral-400">{snapshot.trace.length}</span>
              )}
              {item.id === 'console' && snapshot.console.length > 0 && (
                <span className="ml-1 text-neutral-400">{snapshot.console.length}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || snapshot.status === 'compiling'}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 py-1 font-mono text-[11px] font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          Run
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-3 py-1 dark:border-neutral-800/70">
        <StatusLabel snapshot={snapshot} />
        {snapshot.wizards.length > 1 && (
          <select
            aria-label="Wizard"
            value={handle?.label ?? ''}
            onChange={(event) => setSelectedWizard(event.target.value)}
            className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            {snapshot.wizards.map((candidate) => (
              <option key={candidate.label} value={candidate.label}>
                {candidate.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {snapshot.error && (
        <pre className="shrink-0 whitespace-pre-wrap border-b border-neutral-200 bg-neutral-100 px-3 py-2 font-mono text-[11px] text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
          {snapshot.error}
        </pre>
      )}
      {snapshot.status !== 'idle' && errorDiagnostics.length > 0 && tab !== 'console' && (
        <ul className="max-h-24 shrink-0 overflow-auto border-b border-neutral-200 px-3 py-1.5 font-mono text-[11px] text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {errorDiagnostics.slice(0, 6).map((d) => (
            <li key={`${d.file}:${d.line}:${d.column}:${d.message}`} className="truncate">
              {d.file}:{d.line}:{d.column} — {d.message}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'graph' && (
          <GraphView flow={flow} wizard={wizard} selected={selectedStep} onSelect={selectStep} />
        )}
        {tab === 'trace' && (
          <TraceView trace={snapshot.trace} multiWizard={snapshot.wizards.length > 1} />
        )}
        {tab === 'explain' && (
          <ExplainView wizard={wizard} selected={selectedStep} onSelect={setSelectedStep} />
        )}
        {tab === 'console' && <ConsoleView lines={snapshot.console} />}
      </div>
    </div>
  )
}
