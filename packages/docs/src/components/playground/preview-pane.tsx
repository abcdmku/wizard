import { type KeyboardEvent, useEffect, useState } from 'react'
import { FOCUS_RING, RunButton, tabClass } from './controls'
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

const STATUS_TEXT: Readonly<Record<RunnerSnapshot['status'], string>> = {
  idle: 'Not run yet',
  compiling: 'Compiling…',
  running: 'Running…',
  error: 'Failed',
  done: 'Done',
}

function StatusLabel({ snapshot }: { readonly snapshot: RunnerSnapshot }) {
  const errors = snapshot.diagnostics.filter((d) => d.category === 'error').length
  const { status } = snapshot
  return (
    <span
      className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400"
      role="status"
    >
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          status === 'running' || status === 'compiling'
            ? 'animate-pulse bg-neutral-900 dark:bg-neutral-100'
            : status === 'error'
              ? 'bg-red-500'
              : status === 'done'
                ? 'bg-emerald-500'
                : 'bg-neutral-400'
        }`}
      />
      <span className="truncate">
        {STATUS_TEXT[status]}
        {errors > 0 && (
          <span title="TypeScript errors. The code still runs, as it does under tsx.">
            {' '}
            · {errors} type error{errors === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </span>
  )
}

/** The run status and Run button, the four preview tabs, and the tab that is open. */
export function PreviewPane({ snapshot, onRun, canRun }: PreviewPaneProps) {
  const [tab, setTab] = useState<Tab>('graph')
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<StepRef | null>(null)

  const handle =
    snapshot.runs.find((candidate) => candidate.label === selectedRun) ?? snapshot.runs.at(-1)
  const run = handle?.run
  const wizard = run?.wizard ?? snapshot.wizards[0]

  // A new run replaces the runs: forget a selection that no longer exists.
  useEffect(() => {
    if (selectedRun && !snapshot.runs.some((candidate) => candidate.label === selectedRun)) {
      setSelectedRun(null)
    }
  }, [snapshot.runs, selectedRun])

  const selectStep = (ref: StepRef) => {
    setSelectedStep(ref)
    setTab('explain')
  }

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = TABS.findIndex((item) => item.id === tab)
    const next = TABS[(index + step + TABS.length) % TABS.length]
    if (!next) return
    setTab(next.id)
    event.currentTarget.querySelector<HTMLElement>(`#preview-tab-${next.id}`)?.focus()
  }

  const errorDiagnostics = snapshot.diagnostics.filter((d) => d.category === 'error')

  return (
    <div className="@container/preview flex h-full min-h-0 flex-col bg-paper dark:bg-ink">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <StatusLabel snapshot={snapshot} />
        <div className="flex min-w-0 items-center gap-2">
          {snapshot.runs.length > 1 && (
            <select
              aria-label="Run to show"
              value={handle?.label ?? ''}
              onChange={(event) => setSelectedRun(event.target.value)}
              className={`h-7 min-w-0 max-w-[11rem] rounded-md border border-neutral-200 bg-transparent px-1.5 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:text-neutral-300 [@media(pointer:coarse)]:h-9 ${FOCUS_RING}`}
            >
              {snapshot.runs.map((candidate) => (
                <option key={candidate.label} value={candidate.label}>
                  {candidate.label}
                </option>
              ))}
            </select>
          )}
          {/* On a narrow screen the Run button sits next to the Code / Preview switch instead. */}
          <span className="@2xl/ide:inline-flex hidden">
            <RunButton onRun={onRun} canRun={canRun} status={snapshot.status} />
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 overflow-x-auto border-b border-neutral-200 px-1 dark:border-neutral-800"
        role="tablist"
        aria-label="Preview"
        onKeyDown={onTabKey}
      >
        {TABS.map((item) => {
          const count =
            item.id === 'trace'
              ? snapshot.trace.length
              : item.id === 'console'
                ? snapshot.console.length
                : 0
          return (
            <button
              key={item.id}
              id={`preview-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls="preview-panel"
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              className={tabClass(tab === item.id)}
            >
              {item.label}
              {count > 0 && (
                <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {snapshot.error && (
        <div
          role="alert"
          className="max-h-40 shrink-0 overflow-auto border-b border-neutral-200 border-l-2 border-l-red-600 bg-red-50/70 px-3 py-2 dark:border-neutral-800 dark:border-l-red-500 dark:bg-red-950/25"
        >
          <p className="font-mono text-[11px] font-medium text-red-700 dark:text-red-400">
            The run stopped with an error
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-neutral-900 dark:text-neutral-100">
            {snapshot.error}
          </pre>
        </div>
      )}
      {snapshot.status !== 'idle' && errorDiagnostics.length > 0 && tab !== 'console' && (
        <ul className="max-h-24 shrink-0 overflow-auto border-b border-neutral-200 px-3 py-1.5 font-mono text-[11px] leading-5 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {errorDiagnostics.slice(0, 6).map((d) => (
            <li
              key={`${d.file}:${d.line}:${d.column}:${d.message}`}
              className="truncate"
              title={d.message}
            >
              <span className="text-neutral-900 dark:text-neutral-100">
                {d.file}:{d.line}:{d.column}
              </span>{' '}
              {d.message}
            </li>
          ))}
          {errorDiagnostics.length > 6 && <li>and {errorDiagnostics.length - 6} more</li>}
        </ul>
      )}

      <div
        id="preview-panel"
        role="tabpanel"
        aria-labelledby={`preview-tab-${tab}`}
        className="min-h-0 flex-1 overflow-auto"
      >
        {tab === 'graph' && (
          <GraphView
            wizard={wizard}
            run={run}
            selected={selectedStep}
            onSelect={selectStep}
            status={snapshot.status}
          />
        )}
        {tab === 'trace' && (
          <TraceView trace={snapshot.trace} multiRun={snapshot.runs.length > 1} />
        )}
        {tab === 'explain' && (
          <ExplainView run={run} selected={selectedStep} onSelect={setSelectedStep} />
        )}
        {tab === 'console' && <ConsoleView lines={snapshot.console} />}
      </div>
    </div>
  )
}
