/**
 * @openwizard/core/inspect — describe a wizard without running it: `inspect(flow)` returns the
 * manifest (structure, prose, JSON Schemas, warnings, fingerprint), `toMermaid` draws it,
 * `toJSONSchema` converts one boundary, and `formatTrace` / `traceLine` make run events readable.
 *
 * @packageDocumentation
 */

export type { FlowWarning } from '../authoring/compile'
export { inspect } from './graph'
export { toJSONSchema } from './json-schema'
export { toMermaid } from './mermaid'
export { formatTrace, type TraceLine, traceLine } from './trace'
export type {
  FlowGraph,
  FlowGraphEdge,
  FlowGraphNode,
  GraphEach,
  GraphNeed,
  GraphRetry,
  JSONSchema,
} from './types'
