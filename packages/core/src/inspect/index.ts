/**
 * @openwizard/core/inspect — describe a wizard without running it: `inspect(wizard)` returns the
 * manifest (structure, prose, JSON Schemas, warnings, fingerprint), `toMermaid` draws it,
 * `toMarkdown` writes it as a page,
 * `toJSONSchema` converts one boundary, and `formatTrace` / `traceLine` make run events readable.
 *
 * @packageDocumentation
 */

export type { ManifestWarning } from '../authoring/compile'
export { inspect } from './graph'
export { toJSONSchema } from './json-schema'
export { toMarkdown } from './markdown'
export { toMermaid } from './mermaid'
export { formatTrace, type TraceLine, traceLine } from './trace'
export type {
  GraphEach,
  GraphNeed,
  GraphRetry,
  JSONSchema,
  Manifest,
  ManifestEdge,
  ManifestStep,
} from './types'
