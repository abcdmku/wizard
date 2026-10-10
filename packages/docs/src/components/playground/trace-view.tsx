import { useEffect, useRef } from 'react'
import type { ConsoleEntry, TraceEntry } from './runner'

const TYPE_TONE: Readonly<Record<string, string>> = {
  'flow.': 'text-neutral-900 dark:text-neutral-100 font-semibold',
  'transition.rejected': 'text-neutral-900 dark:text-neutral-100',
  'step.failed': 'text-neutral-900 dark:text-neutral-100',
  'step.runFailed': 'text-neutral-900 dark:text-neutral-100',
  'event.rejected': 'text-neutral-900 dark:text-neutral-100',
  'event.dropped': 'text-neutral-900 dark:text-neutral-100',
  'command.rejected': 'text-neutral-900 dark:text-neutral-100',
}

function toneFor(type: string): string {
  for (const [prefix, tone] of Object.entries(TYPE_TONE)) if (type.startsWith(prefix)) return tone
  return 'text-neutral-600 dark:text-neutral-300'
}

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

/** The Trace tab: every domain event from `observe()` — seq, type, step, path and the payload. */
export function TraceView({
  trace,
  multiWizard,
}: {
  readonly trace: readonly TraceEntry[]
  readonly multiWizard: boolean
}) {
  const ref = useAutoScroll(trace.length)
  if (trace.length === 0) {
    return <p className="p-4 font-mono text-xs text-neutral-500">No events yet — press Run.</p>
  }
  return (
    <div ref={ref} className="h-full overflow-auto">
      <table className="w-full border-collapse font-mono text-[11px] leading-5">
        <thead className="sticky top-0 bg-white text-left text-neutral-500 dark:bg-ink">
          <tr>
            <th className="px-3 py-1 font-normal">seq</th>
            <th className="px-2 py-1 font-normal">type</th>
            <th className="px-2 py-1 font-normal">step</th>
            <th className="px-2 py-1 font-normal">detail</th>
          </tr>
        </thead>
        <tbody>
          {trace.map((entry) => (
            <tr
              key={entry.id}
              className="border-t border-neutral-100 align-top dark:border-neutral-800/70"
            >
              <td className="whitespace-nowrap px-3 py-0.5 text-neutral-400">
                {multiWizard && <span className="mr-1 text-neutral-500">{entry.wizard}</span>}
                {entry.path.length > 0 && (
                  <span className="mr-1 text-neutral-500">{entry.path.join('/')}</span>
                )}
                {entry.seq}
              </td>
              <td className={`whitespace-nowrap px-2 py-0.5 ${toneFor(entry.type)}`}>
                {entry.type}
              </td>
              <td className="whitespace-nowrap px-2 py-0.5 text-neutral-700 dark:text-neutral-300">
                {entry.step ?? ''}
              </td>
              <td className="max-w-[28rem] break-all px-2 py-0.5 text-neutral-500">
                {entry.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The Console tab: `console.*` output of the running code. */
export function ConsoleView({ lines }: { readonly lines: readonly ConsoleEntry[] }) {
  const ref = useAutoScroll(lines.length)
  if (lines.length === 0) {
    return <p className="p-4 font-mono text-xs text-neutral-500">Nothing logged yet.</p>
  }
  return (
    <div ref={ref} className="h-full overflow-auto px-3 py-2 font-mono text-[11.5px] leading-5">
      {lines.map((line) => (
        <div
          key={line.id}
          className={`whitespace-pre-wrap break-words ${
            line.level === 'error' || line.level === 'warn'
              ? 'text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-300'
          }`}
        >
          {line.level !== 'log' && <span className="mr-2 text-neutral-400">[{line.level}]</span>}
          {line.text}
        </div>
      ))}
    </div>
  )
}
