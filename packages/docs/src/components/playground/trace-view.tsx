import { useEffect, useRef } from 'react'
import { EmptyState } from './empty-state'
import type { ConsoleEntry, TraceEntry } from './runner'

/** Events a reader looks for first: the run's own, and anything that failed or was refused. */
const STRONG = /^run\.|failed$|rejected$|dropped$|Failed$/

/** Sticks to the bottom while new rows arrive (like a terminal), unless the user scrolled up. */
function useAutoScroll(dependency: number) {
  const ref = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `dependency` is the trigger (new rows), not a value the effect reads
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [dependency])
  return ref
}

/**
 * Every domain event from `observe()`. One row holds the sequence number, the type and the step.
 * The payload sits on its own line under them, so it wraps at any pane width.
 */
export function TraceView({
  trace,
  multiRun,
}: {
  readonly trace: readonly TraceEntry[]
  readonly multiRun: boolean
}) {
  const ref = useAutoScroll(trace.length)
  if (trace.length === 0) {
    return (
      <EmptyState title="No events yet">
        Every event of a run is listed here in order: steps starting and finishing, retries, waits
        and transitions. Press Run to record them.
      </EmptyState>
    )
  }
  return (
    <div ref={ref} className="h-full overflow-auto">
      <ol className="font-mono text-[11.5px] leading-5">
        {trace.map((entry) => {
          const origin = [multiRun ? entry.run : null, entry.path.join('/')].filter(Boolean)
          return (
            <li
              key={entry.id}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-800/70"
            >
              <span className="text-right text-neutral-400 tabular-nums dark:text-neutral-500">
                {entry.seq}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span
                    className={`break-words ${
                      STRONG.test(entry.type)
                        ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {entry.type}
                  </span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {origin.join(' · ')}
                    {origin.length > 0 && entry.step ? ' › ' : ''}
                    {entry.step && (
                      <span className="text-neutral-900 dark:text-neutral-100">{entry.step}</span>
                    )}
                  </span>
                </div>
                {entry.detail && (
                  <div className="text-[11px] text-neutral-500 [overflow-wrap:anywhere] dark:text-neutral-400">
                    {entry.detail}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The Console tab: `console.*` output of the running code. */
export function ConsoleView({ lines }: { readonly lines: readonly ConsoleEntry[] }) {
  const ref = useAutoScroll(lines.length)
  if (lines.length === 0) {
    return (
      <EmptyState title="Nothing logged yet">
        Whatever the code prints with <code className="font-mono text-[12px]">console.log</code>{' '}
        appears here while it runs.
      </EmptyState>
    )
  }
  return (
    <div ref={ref} className="h-full overflow-auto px-3 py-2 font-mono text-[11.5px] leading-5">
      {lines.map((line) => (
        <div
          key={line.id}
          className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${
            line.level === 'error'
              ? 'text-red-700 dark:text-red-400'
              : line.level === 'warn'
                ? 'text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-300'
          }`}
        >
          {line.level !== 'log' && (
            <span className="mr-2 text-neutral-400 dark:text-neutral-500">[{line.level}]</span>
          )}
          {line.text}
        </div>
      ))}
    </div>
  )
}
