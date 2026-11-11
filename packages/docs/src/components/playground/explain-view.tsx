import type { AnyFlow, Explanation, Run } from '@openwizard/core'
import type { FlowGraph } from '@openwizard/core/inspect'
import { useMemo } from 'react'
import { runAt } from './child-path'
import { stringify } from './format'
import { type StepRef, safeInspect, snapshotAt } from './graph-view'

interface ExplainViewProps {
  readonly run: Run<AnyFlow> | undefined
  readonly selected: StepRef | null
  readonly onSelect: (ref: StepRef) => void
}

type StepExplanation = Explanation<AnyFlow> & { readonly note?: string }

/** `run.explain(step)` for the root, `run.child(...).explain(step)` down a path when the child is live. */
function explainAt(run: Run<AnyFlow>, ref: StepRef): StepExplanation {
  try {
    return runAt(run, ref.path).explain(ref.id)
  } catch (error) {
    return {
      status: snapshotAt(run, ref.path)?.state.steps[ref.id]?.status ?? 'unknown',
      phase: undefined,
      reasons: [],
      candidates: [],
      waitingFor: [],
      note: `child run not live: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex gap-3 border-b border-neutral-100 py-1.5 last:border-b-0 dark:border-neutral-800/70">
      <dt className="w-24 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words text-neutral-800 dark:text-neutral-200">{value}</dd>
    </div>
  )
}

const list = (values: readonly string[]) => (values.length === 0 ? '[]' : values.join(', '))

/** The Explain tab: pick a step, read `{ status, phase, reasons, candidates }` — plus progress and ready views. */
export function ExplainView({ run, selected, onSelect }: ExplainViewProps) {
  const graph = useMemo<FlowGraph | null>(() => {
    if (!run) return null
    const result = safeInspect(run.flow)
    return 'error' in result ? null : result
  }, [run])
  // Computed on every render: the parent re-renders after each batch of events.
  const live = run
    ? {
        explanation: selected ? explainAt(run, selected) : null,
        progress: run.progress(),
        readyViews: run.readyViews(),
        waitingFor: run.waitingFor(),
        status: run.getState().status,
        current: run.getState().current,
      }
    : null

  if (!run || !graph || !live) {
    return (
      <p className="p-4 font-mono text-xs text-neutral-500">
        Run the code, then pick a step to see why it is (not) where you expect.
      </p>
    )
  }
  const { explanation } = live
  const choices = graph.nodes.map((node) => ({
    path: node.path,
    id: node.id,
    kind: node.kind,
    label: node.id,
  }))
  const known = new Set(choices.map((choice) => JSON.stringify([...choice.path, choice.id])))
  const waitingChoices = live.waitingFor
    .filter((wait) => !known.has(JSON.stringify([...wait.path, wait.step])))
    .map((wait) => ({
      path: wait.path,
      id: wait.step,
      kind: wait.kind,
      label: [...wait.path, wait.step].join('/'),
    }))
  return (
    <div className="grid h-full grid-cols-[minmax(7rem,11rem)_1fr] font-mono text-[11.5px]">
      <ul className="overflow-auto border-r border-neutral-200 py-2 dark:border-neutral-800">
        {[...choices, ...waitingChoices].map((node) => {
          const isSelected =
            selected?.id === node.id && selected.path.join('/') === node.path.join('/')
          return (
            <li key={JSON.stringify([...node.path, node.id])}>
              <button
                type="button"
                title={node.label}
                onClick={() => onSelect({ path: node.path, id: node.id })}
                className={`block w-full truncate px-3 py-1 text-left transition-colors ${
                  isSelected
                    ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900/60'
                }`}
                style={{ paddingLeft: `${12 + node.path.length * 10}px` }}
              >
                {node.label} <span className="text-neutral-400">{node.kind}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="overflow-auto px-4 py-2">
        <dl>
          <Row label="flow" value={`${live.status} · current ${live.current ?? '—'}`} />
          <Row
            label="progress"
            value={`${live.progress.done}/${live.progress.total} (${Math.round(live.progress.ratio * 100)}%)`}
          />
          <Row label="readyViews" value={list(live.readyViews)} />
          <Row
            label="waitingFor"
            value={list(
              live.waitingFor.map(
                (wait) => `${[...wait.path, wait.step].join('/')} (${wait.kind})`,
              ),
            )}
          />
        </dl>
        {explanation && selected && (
          <dl className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <Row label="explain" value={[...selected.path, selected.id].join('/')} />
            <Row label="status" value={explanation.status} />
            <Row label="phase" value={explanation.phase ?? 'undefined'} />
            <Row label="reasons" value={list(explanation.reasons)} />
            <Row label="candidates" value={list(explanation.candidates)} />
            {explanation.note && <Row label="note" value={explanation.note} />}
            <Row label="raw" value={stringify(explanation, 600)} />
          </dl>
        )}
      </div>
    </div>
  )
}
