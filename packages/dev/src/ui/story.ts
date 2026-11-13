/**
 * Plain sentences for run events. The history tab shows the events that tell the story of a
 * run by default and hides the machine's bookkeeping (navigation phases, arrivals, timers).
 */

/** A run event as the history reads it: the envelope plus whatever fields its type carries. */
export type LooseEvent = {
  readonly seq: number
  readonly at: number
  readonly type: string
  readonly path?: readonly string[]
  readonly step?: string
} & Readonly<Record<string, unknown>>

/**
 * How a row is marked: the colour of its dot, the same colour the status words use. `good` is
 * done, `bad` failed, `warn` waiting or retrying, `info` running, `undo` undoing or undone, and
 * `plain` skipped, cancelled and everything else.
 */
export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'undo' | 'plain'

/** One row of the history: who it is about and what happened. */
export interface Line {
  /** The step the sentence starts with, as `child / step`, or none for the run itself. */
  readonly step?: readonly string[] | undefined
  readonly text: string
  readonly tone: Tone
  /** False for bookkeeping, which shows only with "All events". */
  readonly story: boolean
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
const message = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && 'message' in value)
    return String((value as { message: unknown }).message)
  return 'unknown error'
}
const issues = (value: unknown): string =>
  Array.isArray(value) && value.length > 0
    ? `: ${value.map((issue: unknown) => message(issue)).join('; ')}`
    : ''
const names = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : (str(value) ?? 'nothing')

/** `0.8s`, `12s`, `4m 05s`, `48h 00m` or `3d 2h`, for a span in milliseconds. */
export function elapsed(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`
  const seconds = Math.round(safe / 1000)
  if (seconds < 60) return `${seconds}s`
  const pad = (value: number) => String(value).padStart(2, '0')
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
  // Hours run up to 72, so a 48 hour timeout reads `48h 00m`, as a wizard declares it.
  if (seconds < 259_200)
    return `${Math.floor(seconds / 3600)}h ${pad(Math.floor(seconds / 60) % 60)}m`
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds / 3600) % 24}h`
}

const took = (event: LooseEvent): string => {
  const ms = num(event.durationMs)
  return ms >= 50 ? ` in ${elapsed(ms)}` : ''
}

const SKIPPED: Readonly<Record<string, string>> = {
  when: 'was skipped: its when check returned false',
  command: 'was skipped by hand',
  'not-taken': 'was skipped: the route chose another step',
  'needs-skipped': 'was skipped: a step it needs was skipped',
  timeout: 'stopped waiting: the deadline passed',
}

/** Steps whose `step.entered` is followed by work, so "started" comes from that work instead. */
const WORK = new Set([
  'step.runStarted',
  'step.idempotencyKeyRequested',
  'step.eachStarted',
  'child.started',
  'step.whenStarted',
])

/** A step that ended as it was entered, such as a routing step, never waited. */
const SETTLED = new Set(['step.done', 'step.skipped', 'step.failed'])
const settledAt = (entered: LooseEvent, next: LooseEvent): boolean =>
  SETTLED.has(next.type) && (next.causedBy === entered.seq || next.at - entered.at < 20)

/**
 * The sentence for each event. `next` is the following event about the same step, which tells
 * a step that waits (a form, an event, a timer) from one that goes on to run.
 */
export function narrate(event: LooseEvent, next: LooseEvent | undefined): Line {
  const step = event.step === undefined ? undefined : [...(event.path ?? []), event.step]
  const line = (text: string, tone: Tone = 'plain', story = true): Line => ({
    step,
    text,
    tone,
    story,
  })
  const quiet = (text: string): Line => ({ step, text, tone: 'plain', story: false })
  // A child's own run events carry the path of the step that runs it: "shipping run finished".
  const owner = event.path !== undefined && event.path.length > 0 ? event.path : undefined
  const run = (text: string, tone: Tone): Line =>
    owner === undefined
      ? { text, tone, story: true }
      : { step: owner, text: `${text.charAt(0).toLowerCase()}${text.slice(1)}`, tone, story: true }
  const e = event
  switch (e.type) {
    case 'run.started':
      return run(`Run started at ${str(e.start) ?? 'its first step'}`, 'info')
    case 'run.done':
      // A child's end shows once, as the line of the step that runs it: "shipping finished".
      return owner === undefined
        ? run('Run finished', 'good')
        : { ...run('Run finished', 'good'), story: false }
    case 'run.failed':
      return run(`Run failed: ${message(e.error)}`, 'bad')
    case 'run.halted':
      return line(
        `stopped the run: ${message(e.error)}. Retry it, skip it or cancel the run`,
        'bad',
      )
    case 'run.cancelled':
      return run(`Run cancelled${str(e.reason) === undefined ? '' : `: ${str(e.reason)}`}`, 'plain')
    case 'dev.restarted':
      return run('Restarted from snapshot: the run was stopped and resumed', 'info')
    case 'run.resumed':
      return run('Run resumed from its snapshot', 'info')
    case 'run.reset':
      return run('Run reset', 'info')
    case 'run.compensating':
      return run(`Undoing finished steps: ${names(e.plan)}`, 'undo')
    case 'run.compensated':
      return Array.isArray(e.failures) && e.failures.length > 0
        ? run(`Undo finished with failures: ${names(e.failures)}`, 'bad')
        : run('Undo finished', 'undo')
    case 'step.entered':
      if (next !== undefined && (WORK.has(next.type) || settledAt(e, next))) return quiet('entered')
      return line('started waiting', 'warn')
    case 'step.runStarted': {
      const attempt = num(e.attempt)
      const again = attempt > 1 ? ` attempt ${attempt}` : ''
      return line(`started${again}${e.resumed === true ? ' again after a resume' : ''}`, 'info')
    }
    case 'step.done': {
      if (e.next !== undefined && e.output === undefined)
        return line(`chose ${names(e.next)}`, 'good')
      return line(`finished${took(e)}`, 'good')
    }
    case 'step.failed':
      return line(`failed: ${message(e.error)}`, 'bad')
    case 'step.runFailed':
      return e.willRetry === true
        ? line(`attempt ${num(e.attempt)} failed: ${message(e.error)}`, 'bad')
        : quiet(`attempt ${num(e.attempt)} failed: ${message(e.error)}`)
    case 'step.retryScheduled':
      return line(`will try again in ${elapsed(num(e.dueAt) - e.at)}`, 'warn')
    case 'step.skipped':
      if (str(e.reason) === 'fallback')
        return line(`failed and was skipped: ${message(e.error)}`, 'bad')
      return line(SKIPPED[str(e.reason) ?? ''] ?? 'was skipped')
    case 'step.validated':
      return line('form submitted', 'good')
    case 'step.validationFailed':
      return line(`form refused${issues(e.issues)}`, 'bad')
    case 'step.cancelled':
      return line('was cancelled')
    case 'step.invalidated':
      return line('was reset and will run again', 'info')
    case 'step.guardEvaluated':
      return e.ok === true
        ? quiet(`${str(e.hook)} allowed`)
        : line(`was blocked by ${str(e.hook)}`, 'bad')
    case 'step.compensationStarted':
      return line('is being undone', 'undo')
    case 'step.compensated':
      return line('was undone', 'undo')
    case 'step.compensationFailed':
      return line(`could not be undone: ${message(e.error)}`, 'bad')
    case 'step.eachStarted':
      return line(`started ${Array.isArray(e.items) ? e.items.length : 0} items`, 'info')
    case 'step.eachItemFailed':
      return line(`item ${num(e.index)} failed: ${message(e.error)}`, 'bad', e.willRetry !== true)
    case 'step.eachRetryScheduled':
      return line(`item ${num(e.index)} will try again in ${elapsed(num(e.dueAt) - e.at)}`, 'warn')
    case 'child.started':
      return line('started a child run', 'info')
    case 'child.summary': {
      const summary = e.summary as { status?: unknown } | undefined
      const status = str(summary?.status) ?? 'changed'
      return line(
        `child run ${status}`,
        status === 'done' ? 'good' : 'plain',
        status !== 'running' && status !== 'done',
      )
    }
    case 'event.delivered':
      return {
        step: [...(e.path ?? []), str(e.to) ?? '?'],
        text: `received ${str(e.event)}`,
        tone: 'good',
        story: true,
      }
    case 'event.rejected':
      return line(`${str(e.event)} was refused${issues(e.issues)}`, 'bad')
    case 'event.buffered':
      return line(`${str(e.event)} is held until a step waits for it`)
    case 'event.dropped':
      return line(`${str(e.event)} was dropped: ${str(e.reason)}`, 'warn')
    case 'event.expired':
      return line(`${str(e.event)} expired before a step took it`, 'warn')
    case 'event.wizardDelivered':
      return line(`The wizard handled ${str(e.event)}`, 'good')
    case 'event.handlerFailed':
      return line(`The ${str(e.event)} handler failed: ${message(e.error)}`, 'bad')
    case 'transition.rejected':
      // A refused form already has its own line, "form refused".
      return str(e.reason) === 'validation'
        ? quiet(`next was refused${issues(e.issues)}`)
        : line(`next was refused: ${str(e.reason)}${issues(e.issues)}`, 'bad')
    case 'transition.failed':
      return line(`next failed: ${message(e.error)}`, 'bad')
    case 'command.rejected':
      return line(`A command was refused: ${str(e.reason)}`, 'bad')
    case 'persist.failed':
      return line(`Saving the run failed: ${str(e.message)}`, 'bad')
    case 'context.changed':
      return line('Context updated')
    case 'timer.scheduled':
      return str(e.purpose) === 'sleep'
        ? line(`sleeps for ${elapsed(num(e.dueAt) - e.at)}`, 'warn')
        : quiet(`${str(e.purpose)} timer set for ${elapsed(num(e.dueAt) - e.at)}`)
    default:
      return quiet(technical(e))
  }
}

/** Bookkeeping events keep their machine name and the one field that matters most. */
function technical(event: LooseEvent): string {
  const detail =
    str(event.phase) ?? str(event.event) ?? str(event.cause) ?? str(event.timerId) ?? undefined
  return detail === undefined ? event.type : `${event.type} ${detail}`
}

/** Pairs each event with the next event about the same step, in one pass from the end. */
export function lines(events: readonly LooseEvent[]): readonly Line[] {
  const after = new Map<string, LooseEvent>()
  const out: Line[] = new Array(events.length)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as LooseEvent
    const key = event.step === undefined ? undefined : [...(event.path ?? []), event.step].join('/')
    out[index] = narrate(event, key === undefined ? undefined : after.get(key))
    if (key !== undefined) after.set(key, event)
  }
  // A child reports its status after each of its events. Only a change of status tells the story.
  const last = new Map<string, string>()
  events.forEach((event, index) => {
    if (event.type !== 'child.summary') return
    const key = [...(event.path ?? []), event.step ?? ''].join('/')
    const line = out[index] as Line
    if (last.get(key) === line.text) out[index] = { ...line, story: false }
    last.set(key, line.text)
  })
  return out
}

/** Rows in a row that say the same thing, as one row and how many times it was said. */
export function collapse<T>(
  rows: readonly T[],
  say: (row: T) => string,
): { row: T; times: number }[] {
  const out: { row: T; times: number }[] = []
  for (const row of rows) {
    const previous = out[out.length - 1]
    if (previous !== undefined && say(previous.row) === say(row)) previous.times++
    else out.push({ row, times: 1 })
  }
  return out
}
