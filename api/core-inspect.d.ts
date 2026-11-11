import { AnyFlow, Boundary, RunEvent, RunEventType, StepKind } from "@openwizard/core";
//#region src/authoring/types/primitives.d.ts
/**
 * A JSON value (`meta` and other data that must survive `JSON.stringify` unchanged).
 * @public
 */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};
//#endregion
//#region src/authoring/compile/index.d.ts
/**
 * A static-analysis warning about a flow (advisory; never thrown).
 * @public
 */
interface FlowWarning {
  readonly code: 'UNREACHABLE' | 'NAV_CYCLE' | 'EXCLUSIVE_JOIN' | 'MULTIPLE_SINKS' | 'NO_SINKS';
  readonly message: string;
  /** Step the warning is about. */
  readonly step?: string;
  /** Run path of the flow the step belongs to (`[]` = root). */
  readonly path: readonly string[];
}
//#endregion
//#region src/inspect/types.d.ts
/**
 * A JSON Schema document (draft 2020-12), as produced by a Standard JSON Schema vendor.
 * @public
 */
type JSONSchema = Readonly<Record<string, unknown>>;
/**
 * Retry facts of a runnable step (the step's own policy, else the flow's default).
 * `when: true` marks a retry predicate (a function, so not part of the manifest).
 * @public
 */
interface GraphRetry {
  readonly retries: number;
  readonly backoff?: number | 'exponential';
  readonly baseMs?: number;
  readonly factor?: number;
  readonly maxBackoffMs?: number;
  readonly jitter?: number;
  readonly when?: true;
}
/** A named pull dependency. Optional needs activate a consumer without propagating skips. @public */
interface GraphNeed {
  readonly kind: 'all' | 'any' | 'optional';
  readonly steps: readonly string[];
}
/** Map execution facts. Item selectors and key functions remain hooks. @public */
interface GraphEach {
  /** Maximum simultaneous items. Absent means unbounded. */
  readonly concurrency?: number;
  readonly keyed?: true;
}
/**
 * One step of the graph. `path` is the run path of the flow the step belongs to
 * (`[]` = root, `['fulfil']` = inside the child of step `fulfil`), so ids never collide across
 * nesting levels.
 * @public
 */
interface FlowGraphNode {
  readonly id: string;
  readonly kind: StepKind;
  readonly label?: string;
  readonly description?: string;
  readonly meta?: Readonly<Record<string, JsonValue>>;
  readonly path: readonly string[];
  /**
   * Hooks the step defines, by their AUTHORING names (`enter`, `run`, `when`, `mapError`,
   * `on:payment.captured`, `waitFor:payment.captured`, a flow step's `context` / `deps` / `output`
   * mappers, or a runnable step's `idempotencyKey` function).
   */
  readonly hooks: readonly string[];
  /**
   * Named output dependencies. Their `needs` edges gate this step. They also activate it,
   * unless a `route` edge points here: then only the routing step does.
   */
  readonly needs?: Readonly<Record<string, GraphNeed>>;
  /** One run or child per snapshotted item, with outputs in item order. */
  readonly each?: GraphEach;
  /** Durable delay in milliseconds, or a hook evaluated when the step starts. */
  readonly sleep?: number | 'dynamic';
  /** Alternate target after retries are exhausted; the happy path can still be a sink. */
  readonly fallback?: string;
  /** Run timeout or event timeout, in ms. */
  readonly timeout?: number;
  /** Successors are chosen at runtime by a `next` function. */
  readonly dynamicNext?: true;
  /** Declared targets of a dynamic `next` (also listed as `route` edges). */
  readonly targets?: readonly string[];
  /** The step is an entry point of its flow. */
  readonly start?: true;
  /** JSON Schema of the draft a view accepts (input side of its `input` boundary). */
  readonly input?: JSONSchema;
  /** JSON Schema of the step's output (view `input`, `output` boundary or run adapter). */
  readonly output?: JSONSchema;
  /** Events an event-driven step waits for (`waitFor` keys). */
  readonly waitsFor?: readonly string[];
  /** A sink: no normal static successor and no consumers pulling its output. */
  readonly completes?: true;
  /** The step declares `compensate` (undone in reverse order when the flow compensates). */
  readonly compensable?: true;
  readonly retry?: GraphRetry;
  /** Name and version of the child flow of a `flow` step (its nodes carry `path: [...path, id]`). */
  readonly child?: {
    readonly name: string;
    readonly version: number;
  };
}
/**
 * A static edge between two steps of the same flow (`path`). `start` edges have no `from`;
 * `route` edges are the declared targets of a dynamic `next`.
 * @public
 */
interface FlowGraphEdge {
  readonly from: string | null;
  readonly to: string;
  readonly kind: 'next' | 'route' | 'needs' | 'fallback' | 'timeout' | 'start';
  /** The named dependency carried by a `needs` edge. */
  readonly alias?: string;
  /** Skip and gating rule for a `needs` edge. */
  readonly mode?: GraphNeed['kind'];
  readonly path: readonly string[];
}
/**
 * The wizard manifest: identity, prose, JSON Schemas, nodes and edges (recursively for child
 * flows) and analysis warnings.
 * @public
 */
interface FlowGraph {
  readonly name: string;
  readonly version: number;
  readonly description?: string;
  readonly meta?: Readonly<Record<string, JsonValue>>;
  /**
   * A structure and schema drift signal, not a behaviour hash: 16 hex chars over step ids,
   * kinds, edges, waited events, child identities and the JSON Schemas. Declaration order and
   * prose (`label`, `description`, `meta`, schema annotations such as `.describe()`) never change
   * it; neither do hook bodies (`run`, `when`, `compensate`, handlers), retry or timeouts. Compare
   * it with the fingerprint a snapshot was saved under to spot a definition that drifted.
   */
  readonly fingerprint: string;
  readonly schemas: {
    readonly context?: JSONSchema;
    readonly events: Readonly<Record<string, JSONSchema | undefined>>;
  };
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  readonly warnings: readonly FlowWarning[];
}
//#endregion
//#region src/inspect/graph.d.ts
/**
 * Describe a flow (compiles it if needed; throws `DEFINITION_INVALID` for a broken flow).
 * Warnings include unreachable steps, blocked joins, navigation cycles and ambiguous sinks.
 * @public
 */
declare function inspect(flow: AnyFlow): FlowGraph;
//#endregion
//#region src/inspect/json-schema.d.ts
/**
 * JSON Schema (draft 2020-12) of one side of a boundary: `'input'` is what callers send (a
 * view draft, an event payload, the initial context), `'output'` what hooks see after parsing.
 * `undefined` when the vendor has no Standard JSON Schema converter (Zod 4 and ArkType have one;
 * checkers and Valibot do not) or cannot represent that side (a Zod `.transform()` output).
 * @public
 */
declare function toJSONSchema(schema: Boundary<unknown, unknown>, side: 'input' | 'output'): JSONSchema | undefined;
//#endregion
//#region src/inspect/markdown.d.ts
/**
 * Render a manifest as a Markdown page for people and coding agents: a title with the version
 * and fingerprint, the `toMermaid` diagram, then per flow (root first, each child flow under its
 * step) a table of when every step starts, what it does and where it leads, followed by one
 * section per step with its needs, guard, retry, timeout, undo hook, hooks and JSON Schemas.
 * Ends with the context fields, the declared events with the steps that wait for or handle
 * them, and the warnings. Only manifest facts are printed: a hook is named, never executed or
 * described. Deterministic for a given manifest.
 * @public
 */
declare function toMarkdown(graph: FlowGraph): string;
//#endregion
//#region src/inspect/mermaid.d.ts
/**
 * Render a manifest as Mermaid: one node per step (text = `label` or id, shape by kind: view
 * `[…]`, step `[[…]]`, flow `[/…/]`, plus a line of tags: `may skip` for a `when` guard,
 * retries, run timeout, `compensable`), a start circle per flow, solid `next` edges, dashed
 * `route` edges to declared targets (a dashed edge to `?` when targets are undeclared),
 * named `needs` labels on joins (merged with activation edges),
 * dashed `timeout` and `fallback` edges, event nodes feeding waits, and every child flow
 * in a `subgraph` titled with its flow name. Deterministic for a given manifest.
 * @public
 */
declare function toMermaid(graph: FlowGraph): string;
//#endregion
//#region src/inspect/trace.d.ts
/**
 * One event of a trace, ready to print: `at` is formatted (see `traceLine`), `step` / `event`
 * are the step and external event it is about (`''` when none), `text` is a plain-English
 * sentence and `detail` the remaining body fields as `key=value`.
 * @public
 */
interface TraceLine {
  readonly seq: number;
  readonly at: string;
  readonly path: readonly string[];
  readonly type: RunEventType;
  readonly step: string;
  readonly event: string;
  readonly text: string;
  readonly detail: string;
}
/**
 * Describe one event. `at` is `+250ms` / `+1.250s` relative to `origin` when given, else
 * `12:34:56.789` for a wall clock or `1234ms` for a virtual (test scheduler) clock.
 * @public
 */
declare function traceLine(event: RunEvent, origin?: number): TraceLine;
/**
 * A readable trace, one line per event: time relative to the first event, `[child/path]` for
 * events of child flows, and a sentence (`charge attempt 2 failed: PSP down, will retry`).
 * Machine bookkeeping (timers, navigation phases, `flow.status`, …) is left out unless
 * `all: true`.
 * @public
 */
declare function formatTrace(events: readonly RunEvent[], options?: {
  readonly all?: boolean;
}): string;
//#endregion
export { type FlowGraph, type FlowGraphEdge, type FlowGraphNode, type FlowWarning, type GraphEach, type GraphNeed, type GraphRetry, type JSONSchema, type TraceLine, formatTrace, inspect, toJSONSchema, toMarkdown, toMermaid, traceLine };
//# sourceMappingURL=inspect.d.ts.map