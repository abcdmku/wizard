/**
 * Draft scopes: how `withStep` writes without copying the whole run per event (D3).
 *
 * `emit` folds each event of a `decide` batch inside `inDraft(batch, ledger, …)`:
 * - `active` (and `steps` when there is no ledger) is copied by the batch's first write; later
 *   writes of the same batch mutate that copy in place. A batch's intermediate states are never
 *   published and the next batch owns none of these copies.
 * - With the interpreter's ledger (`MachineEnv.ledger`), `steps` is ONE table the ledger owns,
 *   written in place by every batch; each overwritten record is journaled so the interpreter can
 *   rebuild any committed version on demand (interpreter/versions.ts).
 * Outside a scope (replay, tests folding with `apply`) every write copies, so every state handed
 * out stays immutable.
 * @internal
 */

import type { StepRecord, WizardState } from '../state'
import type { StepLedger } from '../types'
import { setOwn } from '../util'

type Steps = WizardState['steps']

interface Scope {
  readonly batch: object
  readonly ledger: StepLedger | undefined
}

let scope: Scope | undefined
const owners = new WeakMap<object, object>()

export function inDraft<T>(batch: object, ledger: StepLedger | undefined, fold: () => T): T {
  const outer = scope
  scope = { batch, ledger }
  try {
    return fold()
  } finally {
    scope = outer
  }
}

/**
 * A plain copy of a step table. `Object.assign({}, …)` stays on V8's fast clone path where object
 * spread degrades once its call site turns megamorphic; a `__proto__` step id needs define
 * semantics, so that rare case spreads.
 */
export function copySteps(steps: Steps): Record<string, StepRecord> {
  return Object.hasOwn(steps, '__proto__') ? { ...steps } : Object.assign({}, steps)
}

/** Write `next` as `steps[id]`: in place when the scope owns the table, else into a claimed copy. */
export function writeStep(steps: Steps, id: string, before: StepRecord, next: StepRecord): Steps {
  const owner = scope === undefined ? undefined : (scope.ledger ?? scope.batch)
  if (owner !== undefined && owners.get(steps) === owner) {
    scope?.ledger?.journal(steps, id, before)
    setOwn(steps as Record<string, StepRecord>, id, next)
    return steps
  }
  const out = copySteps(steps)
  if (owner !== undefined) owners.set(out, owner)
  setOwn(out, id, next)
  return out
}

/** `active` with `id` appended or removed, in place when this batch owns the array. */
export function writeActive(
  active: readonly string[],
  id: string,
  add: boolean,
): readonly string[] {
  const batch = scope?.batch
  const out =
    batch !== undefined && owners.get(active) === batch ? (active as string[]) : [...active]
  if (batch !== undefined) owners.set(out, batch)
  if (add) out.push(id)
  else out.splice(out.indexOf(id), 1)
  return out
}
