/**
 * Derived index over a `steps` object — never stored. `withStep` carries it across each write
 * in O(changed); a steps object it has never seen (initial, resumed, reset) is
 * indexed by one scan. This is what keeps scheduling linear: selectors read the pending list
 * and the counters instead of rescanning every record per event.
 *
 * @internal
 */

import type { StepRecord } from './state'

type Steps = Readonly<Record<string, StepRecord>>

interface StepIndex {
  /** Ids with `pendingActivation`, in ascending `arrivedSeq` order. */
  readonly pending: readonly string[]
  /** Records with status `failed`. */
  readonly failed: number
  /** Records with status `done` or `skipped`. */
  readonly completed: number
  /** Records whose `when` predicate is in flight. */
  readonly whenPending: number
  /** Explicitly invalidated idle steps still awaiting a new activation. */
  readonly invalidated: number
}

const indexes = new WeakMap<Steps, StepIndex>()

const isCompleted = (rec: StepRecord): boolean => rec.status === 'done' || rec.status === 'skipped'
const count = (flag: boolean): number => (flag ? 1 : 0)

function build(steps: Steps): StepIndex {
  const pending: StepRecord[] = []
  let failed = 0
  let completed = 0
  let whenPending = 0
  let invalidated = 0
  for (const rec of Object.values(steps)) {
    if (rec.pendingActivation) pending.push(rec)
    failed += count(rec.status === 'failed')
    completed += count(isCompleted(rec))
    whenPending += count(rec.when === 'pending')
    invalidated += count(rec.status === 'idle' && rec.invalidated === true)
  }
  // Stable: ties keep declaration order.
  pending.sort((a, b) => (a.arrivedSeq ?? 0) - (b.arrivedSeq ?? 0))
  return { pending: pending.map((rec) => rec.id), failed, completed, whenPending, invalidated }
}

export function stepIndex(steps: Steps): StepIndex {
  let index = indexes.get(steps)
  if (index === undefined) {
    index = build(steps)
    indexes.set(steps, index)
  }
  return index
}

/** Insert `rec` into an arrival-ordered pending list (arrivals are almost always the newest). */
function insertPending(steps: Steps, pending: readonly string[], rec: StepRecord): string[] {
  const out = [...pending]
  const seq = rec.arrivedSeq ?? 0
  let i = out.length
  while (i > 0 && (steps[out[i - 1] ?? '']?.arrivedSeq ?? 0) > seq) i--
  out.splice(i, 0, rec.id)
  return out
}

function nextPending(
  steps: Steps,
  pending: readonly string[],
  before: StepRecord,
  after: StepRecord,
): readonly string[] {
  if (
    before.pendingActivation === after.pendingActivation &&
    before.arrivedSeq === after.arrivedSeq
  )
    return pending
  const without = before.pendingActivation ? pending.filter((id) => id !== after.id) : pending
  return after.pendingActivation ? insertPending(steps, without, after) : without
}

/**
 * Index `next` (= the steps object `index` describes, with `before` replaced by `after`) from
 * that index. `next` may be the same object written in place (a batch draft).
 */
export function carryIndex(
  index: StepIndex,
  next: Steps,
  before: StepRecord,
  after: StepRecord,
): void {
  indexes.set(next, {
    pending: nextPending(next, index.pending, before, after),
    failed: index.failed - count(before.status === 'failed') + count(after.status === 'failed'),
    completed: index.completed - count(isCompleted(before)) + count(isCompleted(after)),
    whenPending:
      index.whenPending - count(before.when === 'pending') + count(after.when === 'pending'),
    invalidated:
      index.invalidated -
      count(before.status === 'idle' && before.invalidated === true) +
      count(after.status === 'idle' && after.invalidated === true),
  })
}
