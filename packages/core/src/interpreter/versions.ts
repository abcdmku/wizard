/**
 * Published versions of the live step table (D3: no per-event or per-batch copy of `steps`).
 *
 * The machine writes step records in place into ONE table the interpreter's ledger owns and
 * journals each record it overwrites (`MachineEnv.ledger`, machine/apply/draft.ts). Every
 * committed state is published as a view whose `steps` is rebuilt — a copy of its table minus
 * the journal entries written after it — the first time someone reads it, then cached. A run
 * nobody inspects never copies its step table; a reader pays one copy per version it reads, and
 * every published version stays immutable.
 * @internal
 */

import { copySteps } from '../machine/apply/draft'
import type { StepRecord, WizardState } from '../machine/state'
import type { StepLedger } from '../machine/types'
import { setOwn } from '../machine/util'

type Steps = WizardState['steps']

interface Overwrite {
  readonly table: Steps
  readonly id: string
  readonly before: StepRecord
}

interface Version {
  /** The table this version's records live in (later batches may overwrite them in place). */
  readonly table: Steps
  /** Records overwritten after this version, in write order (by the batch that made `next`). */
  readonly overwritten: Overwrite[]
  next: Version | undefined
  steps: Steps | undefined
}

export interface StepVersions {
  readonly ledger: StepLedger
  /** The immutable published view of a committed state. */
  publish(state: WizardState): WizardState
}

export function createStepVersions(): StepVersions {
  let head: Version | undefined
  return {
    ledger: {
      journal(table, id, before) {
        head?.overwritten.push({ table, id, before })
      },
    },
    publish(state) {
      const version: Version = {
        table: state.steps,
        overwritten: [],
        next: undefined,
        steps: undefined,
      }
      if (head !== undefined) head.next = version
      head = version
      return Object.defineProperty({ ...state }, 'steps', {
        enumerable: true,
        get: () => stepsOf(version),
      })
    },
  }
}

/** The version's records: its table with every later overwrite of that table undone, newest first. */
function stepsOf(version: Version): Steps {
  if (version.steps !== undefined) return version.steps
  const chain: Version[] = []
  for (let v: Version | undefined = version; v !== undefined; v = v.next) chain.push(v)
  const out = copySteps(version.table)
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const overwritten = chain[i]?.overwritten ?? []
    for (let j = overwritten.length - 1; j >= 0; j -= 1) {
      const entry = overwritten[j]
      if (entry !== undefined && entry.table === version.table) setOwn(out, entry.id, entry.before)
    }
  }
  version.steps = out
  return out
}
