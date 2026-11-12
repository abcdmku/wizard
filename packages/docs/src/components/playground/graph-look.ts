/**
 * How a step and an arrow look in the playground graph. The colours and the words match the run
 * diagrams on the docs pages: blue runs, amber waits, green is done, red failed, purple is undone.
 */
import type { StepStatus } from '@openwizard/core'

export interface NodeLiveState {
  readonly status: StepStatus
  readonly phase?: string
}

export type Look =
  | 'idle'
  | 'blocked'
  | 'running'
  | 'waiting'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'undoing'
  | 'undone'

export function lookOf(state: NodeLiveState | undefined): Look {
  switch (state?.status) {
    case 'active':
      return state.phase === 'waiting' || state.phase === 'retrying' ? 'waiting' : 'running'
    case 'done':
      return 'done'
    case 'skipped':
    case 'cancelled':
      return 'skipped'
    case 'failed':
      return 'failed'
    case 'compensating':
      return 'undoing'
    case 'compensated':
      return 'undone'
    default:
      return state?.phase === 'blocked' ? 'blocked' : 'idle'
  }
}

/** The word under a step's name. A live phase says more than the status `active`. */
export function captionOf(state: NodeLiveState | undefined): string | null {
  if (!state || (state.status === 'idle' && !state.phase)) return null
  if (state.status === 'active') return state.phase ?? 'active'
  if (state.status === 'idle') return 'waiting for needs'
  return state.status
}

interface LookClasses {
  readonly shape: string
  readonly id: string
  readonly caption: string
}

const TEXT = 'fill-neutral-900 dark:fill-neutral-100'
const MUTED = 'fill-neutral-500 dark:fill-neutral-400'
const QUIET = 'fill-paper stroke-neutral-300 dark:fill-neutral-900 dark:stroke-neutral-700'
const UNDO = 'fill-purple-50 stroke-purple-700 dark:fill-[#2a1440] dark:stroke-purple-400'

export const LOOK_CLASSES: Readonly<Record<Look, LookClasses>> = {
  idle: { shape: `${QUIET} [stroke-width:1.25]`, id: MUTED, caption: MUTED },
  blocked: {
    shape: `${QUIET} [stroke-dasharray:5_4] [stroke-width:1.25]`,
    id: MUTED,
    caption: MUTED,
  },
  running: {
    shape: 'fill-blue-50 stroke-blue-600 [stroke-width:2] dark:fill-[#172554] dark:stroke-blue-400',
    id: TEXT,
    caption: 'fill-blue-600 dark:fill-blue-400',
  },
  waiting: {
    shape:
      'fill-amber-50 stroke-amber-700 [stroke-dasharray:6_4] [stroke-width:2] dark:fill-[#3a2a06] dark:stroke-amber-400',
    id: TEXT,
    caption: 'fill-amber-700 dark:fill-amber-400',
  },
  done: {
    shape:
      'fill-green-50 stroke-green-700 [stroke-width:1.25] dark:fill-[#0d2a17] dark:stroke-green-400',
    id: TEXT,
    caption: 'fill-green-700 dark:fill-green-400',
  },
  skipped: {
    shape:
      'fill-transparent stroke-neutral-300 [stroke-dasharray:3_4] [stroke-width:1.25] dark:stroke-neutral-700',
    id: `${MUTED} line-through`,
    caption: MUTED,
  },
  failed: {
    shape: 'fill-red-50 stroke-red-700 [stroke-width:2] dark:fill-[#3b1212] dark:stroke-red-400',
    id: TEXT,
    caption: 'fill-red-700 dark:fill-red-400',
  },
  undoing: {
    shape: `${UNDO} [stroke-width:2]`,
    id: TEXT,
    caption: 'fill-purple-700 dark:fill-purple-400',
  },
  undone: {
    shape: `${UNDO} [stroke-width:1.25]`,
    id: TEXT,
    caption: 'fill-purple-700 dark:fill-purple-400',
  },
}

export type EdgeTone = 'plain' | 'lit' | 'off'

const STARTED: ReadonlySet<Look> = new Set(['running', 'waiting', 'done', 'undoing', 'undone'])

/** An arrow lights up once its source has finished and its target has started. */
export function edgeTone(from: Look, to: Look, kind: string): EdgeTone {
  const taken = kind === 'fallback' || kind === 'timeout' ? from === 'skipped' : from === 'done'
  if (taken && STARTED.has(to)) return 'lit'
  if (from === 'skipped' || to === 'skipped') return taken ? 'plain' : 'off'
  return 'plain'
}

export const EDGE_TONES: Readonly<
  Record<EdgeTone, { readonly line: string; readonly head: string; readonly label: string }>
> = {
  plain: {
    line: 'stroke-neutral-400 dark:stroke-neutral-600',
    head: 'fill-neutral-400 dark:fill-neutral-600',
    label: 'fill-neutral-500 dark:fill-neutral-400',
  },
  lit: {
    line: 'stroke-neutral-800 dark:stroke-neutral-200',
    head: 'fill-neutral-800 dark:fill-neutral-200',
    label: 'fill-neutral-800 dark:fill-neutral-200',
  },
  off: {
    line: 'stroke-neutral-300 dark:stroke-neutral-800',
    head: 'fill-neutral-300 dark:fill-neutral-800',
    label: 'fill-neutral-400 dark:fill-neutral-600',
  },
}
