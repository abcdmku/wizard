import type { AnyFlow, Explanation, FlowGraph, Wizard } from '@openwizard/core'
import { useMemo } from 'react'
import { stringify } from './format'
import { type StepRef, safeInspect, snapshotAt } from './graph-view'

interface ExplainViewProps {
  readonly wizard: Wizard<AnyFlow> | undefined
  readonly selected: StepRef | null
  readonly onSelect: (ref: StepRef) => void
}

type StepExplanation = Explanation<AnyFlow> & { readonly note?: string }

/** `wizard.explain(step)` for the root, `wizard.child(...).explain(step)` down a path when the child is live. */
function explainAt(wizard: Wizard<AnyFlow>, ref: StepRef): StepExplanation {
  try {
    let target: Wizard<AnyFlow> = wizard
    for (const step of ref.path) target = target.child(step)
    return target.explain(ref.id)
  } catch (error) {
    return {
      status: snapshotAt(wizard, ref.path)?.state.steps[ref.id]?.status ?? 'unknown',
      phase: undefined,
      reasons: [],
      candidates: [],
      note: `child wizard not live: ${error instanceof Error ? error.message : String(error)}`,
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
export function ExplainView({ wizard, selected, onSelect }: ExplainViewProps) {
  const graph = useMemo<FlowGraph | null>(() => {
    if (!wizard) return null
    const result = safeInspect(wizard.flow)
    return 'error' in result ? null : result
  }, [wizard])
  // Computed on every render: the parent re-renders after each batch of events.
  const live = wizard
    ? {
        explanation: selected ? explainAt(wizard, selected) : null,
        progress: wizard.progress(),
        readyViews: wizard.readyViews(),
        status: wizard.getState().status,
        current: wizard.getState().current,
      }
    : null

  if (!wizard || !graph || !live) {
    return (
      <p className="p-4 font-mono text-xs text-neutral-500">
        Run the code, then pick a step to see why it is (not) where you expect.
      </p>
    )
  }
  const { explanation } = live
  return (
    <div className="grid h-full grid-cols-[minmax(7rem,11rem)_1fr] font-mono text-[11.5px]">
      <ul className="overflow-auto border-r border-neutral-200 py-2 dark:border-neutral-800">
        {graph.nodes.map((node) => {
          const isSelected =
            selected?.id === node.id && selected.path.join('/') === node.path.join('/')
          return (
            <li key={`${node.path.join('/')}/${node.id}`}>
              <button
                type="button"
                onClick={() => onSelect({ path: node.path, id: node.id })}
                className={`block w-full truncate px-3 py-1 text-left transition-colors ${
                  isSelected
                    ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900/60'
                }`}
                style={{ paddingLeft: `${12 + node.path.length * 10}px` }}
              >
                {node.id} <span className="text-neutral-400">{node.kind}</span>
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
