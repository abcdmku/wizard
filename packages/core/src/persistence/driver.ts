/**
 * Persistence driver: decides *when* a snapshot is written to the `Store`.
 *
 * - `autoSave: 'change'` — every `notify()` (the interpreter calls it once per
 *   drain that changed state) schedules a write; `debounceMs` coalesces
 *   bursts (0 = write right after the drain).
 * - `save()` writes immediately regardless of `autoSave` and resolves when the
 *   store acknowledged; `flush()` waits for whatever is pending.
 * - Writes are serialized (a slow store can never let an older snapshot win).
 * - `redact(snapshot)` runs right before `store.set`; `clearOnDone` deletes
 *   the key instead of writing once the flow is `done`.
 * - The value is JSON-checked BEFORE `store.set` (`firstNonJson`): a `Map`, class instance,
 *   function, `bigint`, `NaN` or `undefined` array slot anywhere in it — and a `Date` (any
 *   `toJSON()` object) anywhere but where `reviveAt` says a boundary re-parses it on resume —
 *   fails the write with `WizardError('SNAPSHOT_NOT_SERIALIZABLE')` naming the exact path,
 *   instead of letting `JSON.stringify` silently distort what a later resume would read.
 *
 * @internal
 */

import { WizardError } from '../errors'
import type { Scheduler } from '../interpreter/env'
import { firstNonJson } from '../wizard/json'
import type { Snapshot } from '../wizard/snapshot'
import type { Store } from './store'

export type PersistReason = 'change' | 'final' | 'manual'

export interface PersistenceDriverOptions {
  readonly store: Store
  readonly key: string
  readonly autoSave: 'change' | 'off'
  readonly debounceMs: number
  readonly scheduler: Scheduler
  readonly getSnapshot: () => Snapshot
  readonly redact?: ((snapshot: Snapshot) => unknown) | undefined
  readonly clearOnDone?: boolean | undefined
  /** Store failures on the auto-save path (nobody awaits them). Default: rethrow asynchronously. */
  readonly onError?: ((error: unknown) => void) | undefined
  /** May a `toJSON()` object (a `Date`, …) sit at `path` of `value` (a boundary revives it on resume)? Default: never. */
  readonly reviveAt?: ((path: readonly (string | number)[], value: unknown) => boolean) | undefined
}

export interface PersistenceDriver {
  /** A drain changed state; schedule a write when `autoSave` is `'change'`. */
  notify(reason: PersistReason): void
  /** Write now; rejects if the store rejects. */
  save(): Promise<void>
  /** Run a pending debounced write now and wait for every queued write. */
  flush(): Promise<void>
  /** Cancel the debounce timer; a pending write is flushed best-effort. */
  dispose(): void
  /** True while a debounced write is armed (tests). */
  hasPending(): boolean
}

export function createPersistenceDriver(opts: PersistenceDriverOptions): PersistenceDriver {
  let timer: unknown
  let disposed = false
  let chain: Promise<void> = Promise.resolve()

  const onError =
    opts.onError ??
    ((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })

  const write = async (snapshot: Snapshot): Promise<void> => {
    if (opts.clearOnDone === true && snapshot.state.status === 'done') {
      await opts.store.delete(opts.key)
      return
    }
    const value = opts.redact === undefined ? snapshot : opts.redact(snapshot)
    const reviveAt = opts.reviveAt
    const bad = firstNonJson(value, {
      allowUndefinedProperties: true,
      ...(reviveAt === undefined ? {} : { reviveAt: (path) => reviveAt(path, value) }),
    })
    if (bad !== undefined) {
      const location = bad.path.startsWith('.') ? bad.path.slice(1) : bad.path || '<root>'
      const step = stepOf(location)
      // `issues[0].path` carries the location as segments (`['state', 'steps', 'save', 'output', 'createdAt']`).
      throw new WizardError(
        'SNAPSHOT_NOT_SERIALIZABLE',
        `snapshot '${opts.key}' is not JSON-serializable: ${location} ${bad.problem}. ` +
          'Only JSON values survive persistence; a Date (any toJSON() object) only under a schema/parse ' +
          'boundary that re-parses it on resume (task output, view input, context, event — e.g. z.coerce.date()). ' +
          'Otherwise store its JSON form, or keep it out of the state (deps).',
        {
          ...(step === undefined ? {} : { step }),
          issues: [{ message: `${location} ${bad.problem}`, path: bad.segments }],
        },
      )
    }
    await opts.store.set(opts.key, value)
  }

  /**
   * Capture the snapshot NOW (the state this notify/save refers to) and append
   * its write to the serial chain; a slow earlier write can delay it but never
   * change what it persists. The returned promise reflects only this write.
   */
  const enqueueWrite = (): Promise<void> => {
    const snapshot = opts.getSnapshot()
    const p = chain.then(() => write(snapshot))
    chain = p.then(noop, noop)
    return p
  }

  const cancelTimer = (): void => {
    if (timer === undefined) return
    opts.scheduler.clearTimeout(timer)
    timer = undefined
  }

  const runPending = (): void => {
    if (timer === undefined) return
    cancelTimer()
    enqueueWrite().catch(onError)
  }

  return {
    notify() {
      if (disposed || opts.autoSave === 'off') return
      if (opts.debounceMs > 0) {
        cancelTimer()
        timer = opts.scheduler.setTimeout(() => {
          timer = undefined
          enqueueWrite().catch(onError)
        }, opts.debounceMs)
        return
      }
      enqueueWrite().catch(onError)
    },
    save() {
      cancelTimer()
      return enqueueWrite()
    },
    flush() {
      runPending()
      return chain
    },
    dispose() {
      if (disposed) return
      runPending()
      disposed = true
    },
    hasPending: () => timer !== undefined,
  }
}

function noop(): void {}

/** `state.steps.<id>.…` → `<id>` (the step whose record holds the offending value), else undefined. */
function stepOf(location: string): string | undefined {
  const match = /^state\.steps\.([^.[]+)/.exec(location)
  return match?.[1]
}
