/**
 * Snapshot envelope + structural validation.
 *
 * `toSnapshot(state, children, savedAt)` wraps a run state (and its live
 * children's snapshots) in the versioned, JSON-serializable envelope that
 * `Store`s persist. `validateSnapshot(def, unknown)` performs every check
 * that does not need to run user code: envelope, wizard identity, step-set
 * equality, status invariants (`snapshot-state.ts`) and JSON safety
 * (`snapshot-checks.ts`). Boundaries (context, view outputs, inbox payloads)
 * are re-run by `resumeWizardRuntime`.
 *
 * @public
 */

import type { CompiledWizard } from '../authoring/compiled'
import { parseEachChildAddress } from '../interpreter/each-child'
import type { WizardState } from '../machine/state'
import {
  checkJsonSafe,
  describe,
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInt,
  isRecord,
} from './snapshot-checks'
import { checkEachChildren } from './snapshot-each'
import { checkState } from './snapshot-state'

export interface Snapshot {
  readonly v: 1
  readonly wizard: { readonly name: string; readonly version: number }
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly savedAt: number
  readonly state: WizardState
  /** Snapshots of nested runs keyed by the parent's `child` step id. */
  readonly children: Readonly<Record<string, Snapshot>>
}

type SnapshotValidation =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reasons: readonly string[] }

export function toSnapshot(
  state: WizardState,
  children: Readonly<Record<string, Snapshot>>,
  savedAt: number,
): Snapshot {
  return {
    v: 1,
    wizard: { name: state.wizard.name, version: state.wizard.version },
    instanceId: state.instanceId,
    epoch: state.epoch,
    seq: state.seq,
    savedAt,
    state,
    children,
  }
}

/**
 * Structural validation of an untrusted snapshot against a compiled wizard.
 * Never throws; every problem is a human-readable reason (`path: message`).
 */
export function validateSnapshot(def: CompiledWizard, input: unknown): SnapshotValidation {
  const reasons: string[] = []
  if (isSnapshotOf(def, input, reasons)) return { ok: true, snapshot: input }
  return { ok: false, reasons }
}

/** Type predicate so the caller gets a typed `Snapshot` without a cast; recursive over children. */
function isSnapshotOf(def: CompiledWizard, input: unknown, reasons: string[]): input is Snapshot {
  if (!isRecord(input)) {
    reasons.push('snapshot: expected an object')
    return false
  }
  if (input.v !== 1) reasons.push(`v: expected 1, got ${describe(input.v)}`)
  if (!isRecord(input.wizard)) reasons.push('wizard: expected { name, version }')
  else {
    if (input.wizard.name !== def.name) {
      reasons.push(`wizard.name: expected '${def.name}', got ${describe(input.wizard.name)}`)
    }
    if (input.wizard.version !== def.version) {
      reasons.push(`wizard.version: expected ${def.version}, got ${describe(input.wizard.version)}`)
    }
  }
  if (!isNonEmptyString(input.instanceId)) reasons.push('instanceId: expected a non-empty string')
  if (!isNonNegativeInt(input.epoch)) reasons.push('epoch: expected a non-negative integer')
  if (!isNonNegativeInt(input.seq)) reasons.push('seq: expected a non-negative integer')
  if (!isFiniteNumber(input.savedAt)) reasons.push('savedAt: expected a number')
  if (!isRecord(input.children)) reasons.push('children: expected an object')
  if (!isRecord(input.state)) {
    reasons.push('state: expected an object')
    return false
  }

  const state = input.state
  checkState(def, state, reasons)

  // Envelope ↔ state consistency.
  if (isNonNegativeInt(input.seq) && state.seq !== input.seq) {
    reasons.push(
      `state.seq: expected ${String(input.seq)} (envelope seq), got ${describe(state.seq)}`,
    )
  }
  if (isNonEmptyString(input.instanceId) && state.instanceId !== input.instanceId) {
    reasons.push('state.instanceId: does not match the envelope')
  }
  if (isNonNegativeInt(input.epoch) && state.epoch !== input.epoch) {
    reasons.push('state.epoch: does not match the envelope')
  }
  if (
    isRecord(state.wizard) &&
    (state.wizard.name !== def.name || state.wizard.version !== def.version)
  ) {
    reasons.push(`state.wizard: expected ${def.name}@${def.version}`)
  }

  // JSON safety of the persisted state (children are checked recursively below).
  checkJsonSafe(state, 'state', reasons, new Set())

  if (isRecord(input.children)) {
    if (reasons.length === 0 && isRecord(state.steps))
      checkEachChildren(def, state.steps, input.children, reasons)
    for (const [step, child] of Object.entries(input.children)) {
      const address = Object.hasOwn(def.steps, step) ? undefined : parseEachChildAddress(step)
      const owner = address?.step ?? step
      const stepDef = def.steps[owner]
      if (address !== undefined) {
        const record = isRecord(state.steps) ? state.steps[owner] : undefined
        const each = isRecord(record) && isRecord(record.each) ? record.each : undefined
        if (
          stepDef?.each === undefined ||
          each === undefined ||
          !Array.isArray(each.keys) ||
          each.keys[address.index] !== address.key
        ) {
          reasons.push(`children.${step}: item address does not match a mapped child item`)
          continue
        }
      }
      if (stepDef === undefined || stepDef.kind !== 'child' || stepDef.child === undefined) {
        reasons.push(`children.${step}: '${step}' is not a child step`)
        continue
      }
      const nested: string[] = []
      if (!isSnapshotOf(stepDef.child, child, nested)) {
        for (const r of nested) reasons.push(`children.${step}.${r}`)
      }
    }
  }

  return reasons.length === 0
}
