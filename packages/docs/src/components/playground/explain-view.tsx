import type { AnyWizardDefinition, Explanation, Run } from '@openwizard/core'
import type { Manifest } from '@openwizard/core/inspect'
import { useMemo } from 'react'
import { runAt } from './child-path'
import { FOCUS_RING } from './controls'
import { EmptyState } from './empty-state'
import { stringify } from './format'
import { type StepRef, safeInspect, snapshotAt } from './graph-view'

interface ExplainViewProps {
  readonly run: Run<AnyWizardDefinition> | undefined
  readonly selected: StepRef | null
  readonly onSelect: (ref: StepRef) => void
}

type StepExplanation = Explanation<AnyWizardDefinition> & { readonly note?: string }

/** `run.explain(step)` for the root, `run.child(...).explain(step)` down a path when the child is live. */
function explainAt(run: Run<AnyWizardDefinition>, ref: StepRef): StepExplanation {
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

function Row({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="flex gap-3 border-b border-neutral-100 py-1.5 last:border-b-0 dark:border-neutral-800/70">
      <dt className="w-[5.5rem] shrink-0 text-neutral-500 dark:text-neutral-400">{label}</dt>
      {value === null ? (
        <dd className="text-neutral-400 dark:text-neutral-500">none</dd>
      ) : (
        <dd className="min-w-0 text-neutral-800 [overflow-wrap:anywhere] dark:text-neutral-200">
          {value}
        </dd>
      )}
    </div>
  )
}

const list = (values: readonly string[]) => (values.length === 0 ? null : values.join(', '))
const refKey = (ref: StepRef) => JSON.stringify([...ref.path, ref.id])

/** The Explain tab: pick a step, read `{ status, phase, reasons, candidates }` — plus progress and ready views. */
export function ExplainView({ run, selected, onSelect }: ExplainViewProps) {
  const graph = useMemo<Manifest | null>(() => {
    if (!run) return null
    const result = safeInspect(run.wizard)
    return 'error' in result ? null : result
  }, [run])
  // Computed on every render: the parent re-renders after each batch of events.
  const live = run
    ? {
        progress: run.progress(),
        readyViews: run.readyViews(),
        waitingFor: run.waitingFor(),
        status: run.getState().status,
        current: run.getState().current,
      }
    : null

  if (!run || !graph || !live) {
    return (
      <EmptyState title="No run to explain">
        After a run, pick a step here or in the graph to read its status, its phase and the reasons
        it has or has not started.
      </EmptyState>
    )
  }
  const choices = graph.nodes.map((node) => ({
    path: node.path,
    id: node.id,
    kind: node.kind,
    label: node.id,
  }))
  const known = new Set(choices.map(refKey))
  const waitingChoices = live.waitingFor
    .filter((wait) => !known.has(refKey({ path: wait.path, id: wait.step })))
    .map((wait) => ({
      path: wait.path,
      id: wait.step,
      kind: wait.kind,
      label: [...wait.path, wait.step].join('/'),
    }))
  const all = [...choices, ...waitingChoices]
  // A step picked in an earlier run may not exist in this one.
  const current =
    selected && all.some((node) => refKey(node) === refKey(selected)) ? selected : null
  const explanation = current ? explainAt(run, current) : null
  return (
    <div className="@md/preview:grid h-full @md/preview:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] flex flex-col font-mono text-[11.5px]">
      <ul
        aria-label="Steps"
        className="@md/preview:block flex @md/preview:max-h-none max-h-32 shrink-0 flex-wrap gap-1 overflow-auto border-neutral-200 @md/preview:border-r border-b @md/preview:border-b-0 @md/preview:p-0 p-2 @md/preview:py-2 dark:border-neutral-800"
      >
        {all.map((node) => {
          const isSelected = current !== null && refKey(node) === refKey(current)
          return (
            <li key={refKey(node)}>
              <button
                type="button"
                title={node.label}
                aria-pressed={isSelected}
                onClick={() => onSelect({ path: node.path, id: node.id })}
                className={`block @md/preview:w-full max-w-full truncate @md/preview:rounded-none rounded-md @md/preview:border-0 border px-2.5 @md/preview:py-1.5 py-1 text-left transition-colors [@media(pointer:coarse)]:py-2 ${FOCUS_RING} focus-visible:-outline-offset-2 ${
                  isSelected
                    ? 'border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-neutral-100 dark:bg-neutral-800 dark:text-neutral-100'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900'
                }`}
              >
                <span className="@md/preview:inline hidden">
                  {'\u00a0\u00a0'.repeat(node.path.length)}
                </span>
                {node.label}{' '}
                <span className="text-neutral-400 dark:text-neutral-500">{node.kind}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
        <h4 className="pt-1 pb-0.5 text-[10.5px] text-neutral-400 uppercase tracking-wider dark:text-neutral-500">
          Run
        </h4>
        <dl>
          <Row label="status" value={live.status} />
          <Row label="current" value={live.current ?? null} />
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
        <h4 className="mt-3 border-neutral-200 border-t pt-3 pb-0.5 text-[10.5px] text-neutral-400 uppercase tracking-wider dark:border-neutral-800 dark:text-neutral-500">
          Step
          {current && (
            <span className="ml-2 text-[11.5px] text-neutral-900 normal-case tracking-normal dark:text-neutral-100">
              {[...current.path, current.id].join('/')}
            </span>
          )}
        </h4>
        {explanation ? (
          <dl>
            <Row label="status" value={explanation.status} />
            <Row label="phase" value={explanation.phase ?? null} />
            <Row label="reasons" value={list(explanation.reasons)} />
            <Row label="candidates" value={list(explanation.candidates)} />
            {explanation.note && <Row label="note" value={explanation.note} />}
            <Row label="raw" value={stringify(explanation, 600)} />
          </dl>
        ) : (
          <p className="py-1.5 font-sans text-[13px] text-neutral-500 dark:text-neutral-400">
            Pick a step to see what <code className="font-mono text-[12px]">run.explain(step)</code>{' '}
            says about it.
          </p>
        )}
      </div>
    </div>
  )
}
