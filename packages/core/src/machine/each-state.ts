/** Persisted, immutable item records for map steps. @internal */

import type { ChildSummary, StepError } from './state'

export interface EachItem {
  readonly status: 'pending' | 'running' | 'done' | 'failed' | 'retrying'
  readonly attempt: number
  readonly generation?: number
  readonly idempotencyKey?: string
  readonly output?: unknown
  readonly error?: StepError
  readonly retryAt?: number
  readonly child?: ChildSummary
}

export type EachItemPatch = Partial<Pick<EachItem, 'status' | 'attempt' | 'generation'>> & {
  readonly [K in 'output' | 'error' | 'retryAt' | 'child' | 'idempotencyKey']?:
    | EachItem[K]
    | undefined
}

type ItemNode =
  | { readonly items: readonly (EachItem | null)[] }
  | { readonly children: readonly (ItemNode | null)[] }

export interface EachRecords {
  /** Number of branch levels above the item leaves. */
  readonly depth: number
  readonly root: ItemNode
}

export interface EachState {
  readonly items: readonly unknown[]
  readonly keys: readonly string[]
  readonly records: EachRecords
  /** Next item that has never started. Retry items keep their original index. */
  readonly cursor: number
  readonly running: number
  readonly done: number
  readonly childWaiting: number
  readonly childHalted: number
  readonly retrying: number
}

const LEAF_SIZE = 64
const BRANCH_SIZE = 32
const PENDING: EachItem = Object.freeze({ status: 'pending', attempt: 0 })

/**
 * A sparse array trie keeps pending records implicit. Each write copies at most 64 leaf slots
 * and 32 slots per branch level. The depth depends on the original item count, so neither a
 * completion nor a retry copies a growing top-level table. All nodes survive a JSON roundtrip.
 */
export function createEachState(items: readonly unknown[], keys: readonly string[]): EachState {
  let depth = 0
  let capacity = LEAF_SIZE
  while (capacity < items.length) {
    capacity *= BRANCH_SIZE
    depth++
  }
  return {
    items: [...items],
    keys: [...keys],
    records: { depth, root: emptyNode(depth) },
    cursor: 0,
    running: 0,
    done: 0,
    childWaiting: 0,
    childHalted: 0,
    retrying: 0,
  }
}

/** Missing entries are pending; malformed event indices never expose another item's record. */
export function eachItem(state: EachState, index: number): EachItem {
  if (!validIndex(state, index)) return PENDING
  let node = state.records.root
  for (let depth = state.records.depth; depth > 0; depth--) {
    if (!('children' in node)) return PENDING
    const next = node.children[branchIndex(index, depth)]
    if (!next) return PENDING
    node = next
  }
  return 'items' in node ? (node.items[index % LEAF_SIZE] ?? PENDING) : PENDING
}

/** The event reducer owns cursor/running/done updates; this function only changes the record. */
export function updateEachItem(state: EachState, index: number, patch: EachItemPatch): EachState {
  if (!validIndex(state, index)) return state
  const before = eachItem(state, index)
  const { output, error, retryAt, child, idempotencyKey, ...identity } = { ...before, ...patch }
  // Retry events clear optional fields. Keep the stored record free of undefined properties.
  const next: EachItem = {
    ...identity,
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    ...(retryAt === undefined ? {} : { retryAt }),
    ...(child === undefined ? {} : { child }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }
  if (
    before.status === next.status &&
    before.attempt === next.attempt &&
    before.generation === next.generation &&
    before.idempotencyKey === next.idempotencyKey &&
    before.output === next.output &&
    before.error === next.error &&
    before.retryAt === next.retryAt &&
    before.child === next.child
  ) {
    return state
  }
  return {
    ...state,
    childWaiting:
      (state.childWaiting ?? 0) +
      Number(next.status === 'running' && next.child?.status === 'waiting') -
      Number(before.status === 'running' && before.child?.status === 'waiting'),
    childHalted:
      (state.childHalted ?? 0) +
      Number(next.status === 'running' && next.child?.status === 'halted') -
      Number(before.status === 'running' && before.child?.status === 'halted'),
    retrying:
      (state.retrying ?? 0) +
      Number(next.status === 'retrying') -
      Number(before.status === 'retrying'),
    records: {
      ...state.records,
      root: writeItem(state.records.root, state.records.depth, index, next),
    },
  }
}

/** Read results once after completion; item arrival order never changes output order. */
export function eachOutputs(state: EachState): unknown[] {
  const outputs = Array<unknown>(state.items.length).fill(undefined)
  collectOutputs(state.records.root, state.records.depth, 0, outputs)
  return outputs
}

function collectOutputs(node: ItemNode, depth: number, base: number, outputs: unknown[]): void {
  if ('items' in node) {
    for (let slot = 0; slot < node.items.length; slot++) {
      outputs[base + slot] = node.items[slot]?.output
    }
    return
  }
  const stride = LEAF_SIZE * BRANCH_SIZE ** (depth - 1)
  for (let slot = 0; slot < node.children.length; slot++) {
    const child = node.children[slot]
    if (child) collectOutputs(child, depth - 1, base + slot * stride, outputs)
  }
}

function validIndex(state: EachState, index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < state.items.length
}

function emptyNode(depth: number): ItemNode {
  return depth === 0 ? { items: [] } : { children: [] }
}

function branchIndex(index: number, depth: number): number {
  return Math.floor(index / (LEAF_SIZE * BRANCH_SIZE ** (depth - 1))) % BRANCH_SIZE
}

function writeItem(node: ItemNode, depth: number, index: number, item: EachItem): ItemNode {
  if (depth === 0) {
    const items = 'items' in node ? [...node.items] : []
    const slot = index % LEAF_SIZE
    while (items.length <= slot) items.push(null)
    items[slot] = item
    return { items }
  }
  const children = 'children' in node ? [...node.children] : []
  const slot = branchIndex(index, depth)
  while (children.length <= slot) children.push(null)
  children[slot] = writeItem(children[slot] ?? emptyNode(depth - 1), depth - 1, index, item)
  return { children }
}
