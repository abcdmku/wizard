import { Play } from 'lucide-react'
import type { RunStatus } from './runner'

/** A visible keyboard focus ring for the playground's own buttons, tabs and pickers. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:focus-visible:outline-neutral-100'

/** Taller rows on a touch screen, so a finger can hit a tab or a button. */
export const TOUCH_ROW = '[@media(pointer:coarse)]:min-h-11'

/** An underlined tab, shared by the file tabs, the Code / Preview switch and the preview tabs. */
export function tabClass(selected: boolean): string {
  return `-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 font-mono text-xs transition-colors ${TOUCH_ROW} ${FOCUS_RING} focus-visible:-outline-offset-2 ${
    selected
      ? 'border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
      : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
  }`
}

const BUSY: Readonly<Partial<Record<RunStatus, string>>> = {
  compiling: 'Compiling',
  running: 'Running',
}

/** Runs the code. It waits for the editor, because the editor's TypeScript worker compiles it. */
export function RunButton({
  onRun,
  canRun,
  status,
  className = '',
}: {
  readonly onRun: () => void
  readonly canRun: boolean
  readonly status: RunStatus
  readonly className?: string
}) {
  const busy = BUSY[status]
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={!canRun || status === 'compiling'}
      title={canRun ? 'Run the code (Ctrl or Cmd + Enter)' : 'The editor is still loading'}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-3 font-mono text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 [@media(pointer:coarse)]:h-9 ${FOCUS_RING} ${className}`}
    >
      <Play className="h-3 w-3" aria-hidden="true" />
      {busy ? `${busy}…` : 'Run'}
    </button>
  )
}
