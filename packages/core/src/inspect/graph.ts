/**
 * `inspect(flow)` — the wizard manifest: nodes, edges, JSON Schemas, prose, warnings and a
 * structural fingerprint, recursing into child flows with `path`. Nothing here runs a hook.
 *
 * @packageDocumentation
 */

import type { AnyFlow } from '@openwizard/core'
import { isBoundary } from '../authoring/boundary'
import { analyze, type FlowWarning } from '../authoring/compile'
import type { CompiledFlow } from '../authoring/compiled'
import { isRecord } from '../record'
import { fingerprint } from './fingerprint'
import { exclusiveJoinWarnings } from './joins'
import { toJSONSchema } from './json-schema'
import { declaredTargets, prose, toNode } from './node'
import type { FlowGraph, FlowGraphEdge, FlowGraphNode, JSONSchema } from './types'

/**
 * Describe a flow (compiles it if needed; throws `DEFINITION_INVALID` for a broken flow).
 * Warnings include unreachable steps, blocked joins, navigation cycles and ambiguous sinks.
 * @public
 */
export function inspect(flow: AnyFlow): FlowGraph {
  const { compiled, warnings } = analyze(flow)
  const nodes: FlowGraphNode[] = []
  const edges: FlowGraphEdge[] = []
  const joinWarnings: FlowWarning[] = []
  collect(compiled, [], nodes, edges, joinWarnings)
  const schemas = flowSchemas(compiled)
  return {
    name: compiled.name,
    version: compiled.version,
    ...prose(compiled),
    fingerprint: fingerprint({ schemas, nodes, edges }),
    schemas,
    nodes,
    edges,
    warnings: [...warnings, ...joinWarnings],
  }
}

function collect(
  def: CompiledFlow,
  path: readonly string[],
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
  warnings: FlowWarning[],
): void {
  const starts = new Set(def.start)
  const sinks = new Set(def.sinks)
  const raw = rawSteps(def)
  const children: Array<readonly [string, CompiledFlow]> = []
  for (const id of def.start) edges.push({ from: null, to: id, kind: 'start', path })
  for (const id of def.order) {
    const step = def.steps[id]
    if (step === undefined) continue
    nodes.push(
      toNode(step, raw[id], {
        path,
        start: starts.has(id),
        sink: sinks.has(id),
        retry: def.policies.retry,
      }),
    )
    if (step.next.kind === 'static') {
      for (const to of step.next.targets) edges.push({ from: id, to, kind: 'next', path })
    }
    for (const to of declaredTargets(step) ?? []) edges.push({ from: id, to, kind: 'route', path })
    for (const [alias, need] of Object.entries(step.needs ?? {})) {
      for (const from of need.steps)
        edges.push({ from, to: id, kind: 'needs', alias, mode: need.kind, path })
    }
    if (step.fallback !== undefined) {
      edges.push({ from: id, to: step.fallback, kind: 'fallback', path })
    }
    if (step.waitTimeout !== undefined) {
      edges.push({ from: id, to: step.waitTimeout.next, kind: 'timeout', path })
    }
    if (step.child !== undefined) children.push([id, step.child])
  }
  warnings.push(...exclusiveJoinWarnings(def, path))
  // A flow's own nodes/edges come first, then its child flows (in declaration order).
  for (const [id, child] of children) collect(child, [...path, id], nodes, edges, warnings)
}

/** The authoring step records of a compiled flow (its `identity` is the flow object). */
function rawSteps(def: CompiledFlow): Readonly<Record<string, unknown>> {
  const flow: unknown = def.identity
  return isRecord(flow) && isRecord(flow.steps) ? flow.steps : {}
}

/** JSON Schemas of the context (input side: what `create` accepts) and of every event payload. */
function flowSchemas(def: CompiledFlow): FlowGraph['schemas'] {
  const flow: unknown = def.identity
  if (!isRecord(flow)) return { events: {} }
  const context = isBoundary(flow.context) ? toJSONSchema(flow.context, 'input') : undefined
  const events: Record<string, JSONSchema | undefined> = {}
  for (const name of Object.keys(def.events)) {
    const schema = isRecord(flow.events) ? flow.events[name] : undefined
    events[name] = isBoundary(schema) ? toJSONSchema(schema, 'input') : undefined
  }
  return { ...(context !== undefined ? { context } : {}), events }
}
