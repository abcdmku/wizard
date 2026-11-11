/** Structural map-state checks keep untrusted snapshots out of the item executor. */

import type { CompiledWizard } from '../authoring/compiled'
import { eachChildAddress } from '../interpreter/each-child'
import { type EachState, eachItem } from '../machine/each-state'
import { isFiniteNumber, isNonNegativeInt, isRecord } from './snapshot-checks'

export function checkEach(value: unknown, at: string, reasons: string[]): void {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.keys)) {
    reasons.push(`${at}: expected { items, keys, records, cursor, running, done }`)
    return
  }
  const total = value.items.length
  if (
    value.keys.length !== total ||
    !value.keys.every((key) => typeof key === 'string') ||
    new Set(value.keys).size !== total
  )
    reasons.push(`${at}.keys: expected one unique string per item`)
  for (const key of ['cursor', 'running', 'done', 'childWaiting', 'childHalted', 'retrying'])
    if (!isNonNegativeInt(value[key]) || value[key] > total)
      reasons.push(`${at}.${key}: expected an integer between 0 and ${total}`)
  let depth = 0
  for (let capacity = 64; capacity < total; capacity *= 32) depth++
  if (!isRecord(value.records) || value.records.depth !== depth) {
    reasons.push(`${at}.records: expected an item trie of depth ${depth}`)
    return
  }
  let done = 0
  let running = 0
  let childWaiting = 0
  let childHalted = 0
  let retrying = 0
  const visit = (node: unknown, level: number, base: number, path: string): void => {
    const key = level === 0 ? 'items' : 'children'
    const max = level === 0 ? 64 : 32
    if (!isRecord(node) || !Array.isArray(node[key]) || node[key].length > max) {
      reasons.push(`${path}: expected { ${key}: array of at most ${max} entries }`)
      return
    }
    node[key].forEach((entry: unknown, slot: number) => {
      if (entry === null) return
      const nextAt = `${path}.${key}[${slot}]`
      const index = base + slot * (level === 0 ? 1 : 64 * 32 ** (level - 1))
      if (index >= total) {
        reasons.push(`${nextAt}: outside the item list`)
        return
      }
      if (level > 0) {
        visit(entry, level - 1, index, nextAt)
        return
      }
      if (
        !isRecord(entry) ||
        !['pending', 'running', 'done', 'failed', 'retrying'].includes(String(entry.status)) ||
        !isNonNegativeInt(entry.attempt)
      ) {
        reasons.push(`${nextAt}: expected { status, attempt, output?, error?, retryAt?, child? }`)
        return
      }
      if (entry.generation !== undefined && !isNonNegativeInt(entry.generation))
        reasons.push(`${nextAt}.generation: expected a non-negative integer`)
      if (
        entry.child !== undefined &&
        (!isRecord(entry.child) ||
          ![
            'idle',
            'running',
            'waiting',
            'halted',
            'done',
            'failed',
            'cancelled',
            'compensating',
          ].includes(String(entry.child.status)) ||
          !isNonNegativeInt(entry.child.seq))
      )
        reasons.push(`${nextAt}.child: expected { status, current, progress, seq }`)
      if (entry.retryAt !== undefined && !isFiniteNumber(entry.retryAt))
        reasons.push(`${nextAt}.retryAt: expected a finite timestamp`)
      if (entry.status === 'done') done++
      if (entry.status === 'running') {
        running++
        if (isRecord(entry.child) && entry.child.status === 'waiting') childWaiting++
        if (isRecord(entry.child) && entry.child.status === 'halted') childHalted++
      }
      if (entry.status === 'retrying') retrying++
    })
  }
  visit(value.records.root, depth, 0, `${at}.records.root`)
  if (value.done !== done) reasons.push(`${at}.done: expected ${done} completed records`)
  if (value.childWaiting !== childWaiting)
    reasons.push(`${at}.childWaiting: expected ${childWaiting} waiting child records`)
  if (value.childHalted !== childHalted)
    reasons.push(`${at}.childHalted: expected ${childHalted} halted child records`)
  if (value.retrying !== retrying)
    reasons.push(`${at}.retrying: expected ${retrying} retrying records`)
  if (value.running !== running) reasons.push(`${at}.running: expected ${running} running records`)
}

/** Checked state shapes let us verify that every running mapped child can actually resume. */
export function checkEachChildren(
  def: CompiledWizard,
  steps: Record<string, unknown>,
  children: Record<string, unknown>,
  reasons: string[],
): void {
  for (const [id, step] of Object.entries(def.steps)) {
    if (step.kind !== 'child' || step.each === undefined) continue
    const record = steps[id]
    if (
      !isRecord(record) ||
      !isRecord(record.each) ||
      (record.status !== 'active' && record.status !== 'failed')
    )
      continue
    // checkState has validated the item trie before this association check.
    const each = record.each as unknown as EachState
    for (let index = 0; index < each.items.length; index++) {
      const item = eachItem(each, index)
      if (item.status !== 'running' || item.child === undefined) continue
      const key = each.keys[index]
      if (key === undefined) continue
      const address = eachChildAddress(id, index, key, def.steps)
      if (!Object.hasOwn(children, address))
        reasons.push(
          `children.${address}: missing snapshot for running mapped child '${id}' item ${index}`,
        )
    }
  }
}
