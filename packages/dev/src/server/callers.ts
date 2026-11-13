/**
 * Which step made each service call. A call does not name its caller, so the store follows the
 * run's events: a step that starts its work (`step.runStarted`, one item of a mapped step, an
 * undo hook) joins a queue, and each new call goes to the oldest step in the queue. A step
 * leaves the queue when it makes a call and joins it again when that call is answered, so a step
 * that makes two calls in a row gets both. A step that finishes leaves the queue.
 */

/** The step a call came from, with the path of its run. */
export interface Caller {
  readonly path: readonly string[]
  readonly step: string
  /** The attempt of the step, from 1, when its start event said. */
  readonly attempt?: number
  /** True when the step's undo hook made the call. */
  readonly undo?: true
}

/** The fields of a run event the tracker reads. */
interface Seen {
  readonly type: string
  readonly step?: string
  readonly path?: readonly string[]
  readonly index?: number
  readonly attempt?: number
}

interface Worker extends Caller {
  /** The worker's key: path, step and the item of a mapped step. */
  readonly key: string
}

/** Follows the events of a run and names the step behind each call. */
export interface CallerTracker {
  /** Reads one event of the run or of a child. */
  observe(event: Seen): void
  /** A new call was made. It goes to the oldest step that is working and not yet waiting. */
  called(id: string): void
  /** A call was answered, so its step works again and may call again. */
  settled(id: string): void
  /** The step that made a call, or `undefined` when no step could be named. */
  of(id: string): Caller | undefined
  /** Forgets everything, for a run resumed from its snapshot. */
  reset(): void
}

const START = new Set(['step.runStarted', 'step.eachItemStarted', 'step.compensationStarted'])
const ITEM_END = new Set(['step.eachItemCompleted', 'step.eachItemFailed'])
const STEP_END = new Set([
  'step.runSucceeded',
  'step.runFailed',
  'step.done',
  'step.failed',
  'step.skipped',
  'step.cancelled',
  'step.compensated',
  'step.compensationFailed',
])

const keyOf = (path: readonly string[], step: string, index?: number): string =>
  [...path, step, index === undefined ? '' : `#${index}`].join('/')

/** A tracker for one run tree. */
export function createCallerTracker(): CallerTracker {
  /** Steps working and not waiting on a call, oldest first. */
  let ready: Worker[] = []
  /** Steps working, by key, whether or not they wait on a call. */
  let working = new Map<string, Worker>()
  /** The worker behind each open call. */
  let calls = new Map<string, Worker>()
  /** The step behind each open call, as the store reports it. */
  let named = new Map<string, Caller>()

  const leave = (match: (worker: Worker) => boolean) => {
    ready = ready.filter((worker) => !match(worker))
    for (const [key, worker] of working) if (match(worker)) working.delete(key)
  }

  return {
    observe(event) {
      const step = event.step
      if (step === undefined) return
      const path = event.path ?? []
      if (START.has(event.type)) {
        const index = event.type === 'step.eachItemStarted' ? event.index : undefined
        const key = keyOf(path, step, index)
        leave((worker) => worker.key === key)
        const worker: Worker = {
          key,
          path,
          step,
          ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
          ...(event.type === 'step.compensationStarted' ? { undo: true as const } : {}),
        }
        working.set(key, worker)
        ready.push(worker)
      } else if (ITEM_END.has(event.type)) {
        const key = keyOf(path, step, event.index)
        leave((worker) => worker.key === key)
      } else if (STEP_END.has(event.type)) {
        const prefix = keyOf(path, step)
        leave((worker) => worker.key === prefix || worker.key.startsWith(`${prefix}#`))
      }
    },
    called(id) {
      const worker = ready.shift()
      if (worker === undefined) return
      calls.set(id, worker)
      const { key: _key, ...caller } = worker
      named.set(id, caller)
    },
    settled(id) {
      const worker = calls.get(id)
      calls.delete(id)
      named.delete(id)
      if (worker !== undefined && working.get(worker.key) === worker) ready.push(worker)
    },
    of: (id) => named.get(id),
    reset() {
      ready = []
      working = new Map()
      calls = new Map()
      named = new Map()
    },
  }
}
