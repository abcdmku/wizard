/**
 * The wizard manifest: what `inspect(flow)` returns. One JSON-serializable document describing a
 * flow and its child flows (structure, prose, JSON Schemas, warnings) that feeds docs pages,
 * Mermaid, devtools, OpenAPI and SDK generators.
 *
 * @packageDocumentation
 */

import type { StepKind } from '@openwizard/core'
import type { FlowWarning } from '../authoring/compile'
import type { JsonValue } from '../authoring/types/primitives'

/**
 * A JSON Schema document (draft 2020-12), as produced by a Standard JSON Schema vendor.
 * @public
 */
export type JSONSchema = Readonly<Record<string, unknown>>

/**
 * Retry facts of a runnable step (the step's own policy, else the flow's default).
 * `when: true` marks a retry predicate (a function, so not part of the manifest).
 * @public
 */
export interface GraphRetry {
  readonly retries: number
  readonly backoff?: number | 'exponential'
  readonly baseMs?: number
  readonly factor?: number
  readonly maxBackoffMs?: number
  readonly jitter?: number
  readonly when?: true
}

/** A named pull dependency. Optional needs activate a consumer without propagating skips. @public */
export interface GraphNeed {
  readonly kind: 'all' | 'any' | 'optional'
  readonly steps: readonly string[]
}

/** Map execution facts. Item selectors and key functions remain hooks. @public */
export interface GraphEach {
  /** Maximum simultaneous items. Absent means unbounded. */
  readonly concurrency?: number
  readonly keyed?: true
}

/**
 * One step of the graph. `path` is the run path of the flow the step belongs to
 * (`[]` = root, `['fulfil']` = inside the child of step `fulfil`), so ids never collide across
 * nesting levels.
 * @public
 */
export interface FlowGraphNode {
  readonly id: string
  readonly kind: StepKind
  readonly label?: string
  readonly description?: string
  readonly meta?: Readonly<Record<string, JsonValue>>
  readonly path: readonly string[]
  /**
   * Hooks the step defines, by their AUTHORING names (`enter`, `run`, `when`, `mapError`,
   * `on:payment.captured`, `waitFor:payment.captured`, a flow step's `context` / `deps` / `output`
   * mappers, or a runnable step's `idempotencyKey` function).
   */
  readonly hooks: readonly string[]
  readonly dependsOn?: { readonly all: readonly string[] } | { readonly any: readonly string[] }
  /** Named output dependencies. Their `needs` edges both gate and activate this step. */
  readonly needs?: Readonly<Record<string, GraphNeed>>
  /** One run or child per snapshotted item, with outputs in item order. */
  readonly each?: GraphEach
  /** Durable delay in milliseconds, or a hook evaluated when the step starts. */
  readonly sleep?: number | 'dynamic'
  /** Alternate target after retries are exhausted; the happy path can still be a sink. */
  readonly fallback?: string
  /** Run timeout or event timeout, in ms. */
  readonly timeout?: number
  /** Successors are chosen at runtime by a `next` function. */
  readonly dynamicNext?: true
  /** Declared targets of a dynamic `next` (also listed as `route` edges). */
  readonly targets?: readonly string[]
  /** The step is an entry point of its flow. */
  readonly start?: true
  /** JSON Schema of the draft a view accepts (input side of its `input` boundary). */
  readonly input?: JSONSchema
  /** JSON Schema of the step's output (view `input`, `output` boundary or run adapter). */
  readonly output?: JSONSchema
  /** Events an event-driven step waits for (`waitFor` keys). */
  readonly waitsFor?: readonly string[]
  /** A sink: no normal static successor and no consumers pulling its output. */
  readonly completes?: true
  /** The step declares `compensate` (undone in reverse order when the flow compensates). */
  readonly compensable?: true
  readonly retry?: GraphRetry
  /** Name and version of the child flow of a `flow` step (its nodes carry `path: [...path, id]`). */
  readonly child?: { readonly name: string; readonly version: number }
}

/**
 * A static edge between two steps of the same flow (`path`). `start` edges have no `from`;
 * `route` edges are the declared targets of a dynamic `next`.
 * @public
 */
export interface FlowGraphEdge {
  readonly from: string | null
  readonly to: string
  readonly kind: 'next' | 'route' | 'dependsOn' | 'needs' | 'fallback' | 'timeout' | 'start'
  /** The named dependency carried by a `needs` edge. */
  readonly alias?: string
  /** Skip and gating rule for a `needs` edge. */
  readonly mode?: GraphNeed['kind']
  readonly path: readonly string[]
}

/**
 * The wizard manifest: identity, prose, JSON Schemas, nodes and edges (recursively for child
 * flows) and analysis warnings.
 * @public
 */
export interface FlowGraph {
  readonly name: string
  readonly version: number
  readonly description?: string
  readonly meta?: Readonly<Record<string, JsonValue>>
  /**
   * A structure and schema drift signal, not a behaviour hash: 16 hex chars over step ids,
   * kinds, edges, waited events, child identities and the JSON Schemas. Declaration order and
   * prose (`label`, `description`, `meta`, schema annotations such as `.describe()`) never change
   * it; neither do hook bodies (`run`, `when`, `compensate`, handlers), retry or timeouts. Compare
   * it with the fingerprint a snapshot was saved under to spot a definition that drifted.
   */
  readonly fingerprint: string
  readonly schemas: {
    readonly context?: JSONSchema
    readonly events: Readonly<Record<string, JSONSchema | undefined>>
  }
  readonly nodes: readonly FlowGraphNode[]
  readonly edges: readonly FlowGraphEdge[]
  readonly warnings: readonly FlowWarning[]
}
