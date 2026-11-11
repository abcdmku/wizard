/**
 * The manifest fingerprint: a stable hash of a flow's structure (ids, kinds, edges, schemas,
 * waited events, child identities) for drift detection. Independent of declaration order, of
 * prose (labels, descriptions, meta, JSON Schema annotations) and of tuning (retry, timeouts).
 * It is a structure / schema drift signal, NOT a behaviour hash: hooks are functions, so adding
 * a `when` guard, a `compensate` hook or changing a `run` body leaves it unchanged.
 * @internal
 */

import type { FlowGraph, FlowGraphNode, JSONSchema } from './types'

/** 16 hex chars; equal for structurally equal manifests. */
export function fingerprint({
  schemas,
  nodes,
  edges,
}: Pick<FlowGraph, 'schemas' | 'nodes' | 'edges'>): string {
  const structure = {
    context: stripSchema(schemas.context),
    events: Object.keys(schemas.events)
      .sort()
      .map((name) => [name, stripSchema(schemas.events[name])]),
    nodes: nodes.map(structuralNode).map(canonical).sort(),
    edges: edges.map(canonical).sort(),
  }
  return hash64(canonical(structure))
}

/** The drift-relevant facts of a node (no prose, no tuning such as retry or timeouts). */
function structuralNode(node: FlowGraphNode): unknown {
  return {
    path: node.path,
    id: node.id,
    kind: node.kind,
    dependsOn: node.dependsOn ?? null,
    needs: node.needs ?? null,
    each: node.each !== undefined,
    sleep: node.sleep !== undefined,
    dynamicNext: node.dynamicNext ?? null,
    waitsFor: node.waitsFor ?? null,
    child: node.child ?? null,
    input: stripSchema(node.input),
    output: stripSchema(node.output),
  }
}

function stripSchema(schema: JSONSchema | undefined): unknown {
  return schema === undefined ? null : bare(schema)
}

/** JSON Schema keywords that only annotate (prose), never constrain. */
const ANNOTATIONS = new Set(['title', 'description', 'examples', '$comment'])
/** Keywords whose value maps NAMES to subschemas (the names themselves are structure). */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions'])
/** Keywords whose value is data, not a subschema. */
const DATA = new Set(['const', 'enum', 'default', 'required'])

/** A JSON Schema without annotation keywords, at every subschema position. */
function bare(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(bare)
  if (typeof schema !== 'object' || schema === null) return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue
    if (DATA.has(key)) out[key] = value
    else if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null)
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, bare(sub)]))
    else out[key] = bare(value)
  }
  return out
}

/** JSON with object keys sorted (arrays keep their order). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/** Two independent 32-bit FNV-1a lanes → 64 bits as 16 hex chars. */
function hash64(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
    b ^= b >>> 15
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
