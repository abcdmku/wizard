/**
 * `inspect(flow)` — the static graph of a flow (nodes, edges, warnings), recursing into child
 * flows with `path`. This is exactly what a visualizer / devtools panel consumes; nothing here
 * runs a hook.
 *
 * @packageDocumentation
 */

import { analyze, type FlowWarning } from '../authoring/compile'
import type { CompiledFlow, CompiledStep, DepsSpec } from '../authoring/compiled'
import type { AnyFlow, StepKind } from '../authoring/types'

/**
 * One step of the graph. `path` is the wizard path of the flow the step belongs to
 * (`[]` = root, `['fulfil']` = inside the child of step `fulfil`), so ids never collide across
 * nesting levels. `dynamicNext` marks a step whose successors are only known at runtime.
 * @public
 */
export interface FlowGraphNode {
  readonly id: string
  readonly kind: StepKind
  readonly label?: string
  readonly path: readonly string[]
  /**
   * Hooks the step defines, by their AUTHORING names (`enter`, `run`, `when`, `mapError`,
   * `on:payment.captured`, a flow step's `context` / `deps` / `output` mappers, a final's
   * `output`, a task's `idempotent` key function, …).
   */
  readonly hooks: readonly string[]
  readonly dependsOn?: DepsSpec
  /** Task timeout or wait timeout, in ms. */
  readonly timeout?: number
  readonly dynamicNext?: true
  /** The step is an entry point of its flow. */
  readonly start?: true
}

/**
 * A static edge between two steps of the same flow (`path`). `start` edges have no `from`.
 * @public
 */
export interface FlowGraphEdge {
  readonly from: string | null
  readonly to: string
  readonly kind: 'next' | 'dependsOn' | 'timeout' | 'start'
  readonly path: readonly string[]
}

/**
 * The static graph of a flow: nodes, edges and analysis warnings (recursively for child flows).
 * @public
 */
export interface FlowGraph {
  readonly name: string
  readonly version: number
  readonly nodes: readonly FlowGraphNode[]
  readonly edges: readonly FlowGraphEdge[]
  readonly warnings: readonly FlowWarning[]
}

/**
 * Build the static graph of a flow (compiles it if needed; throws `DEFINITION_INVALID` for a
 * broken flow). Warnings: `UNREACHABLE`, `NEVER_ACTIVATES`, `NAV_CYCLE`.
 * @public
 */
export function inspect(flow: AnyFlow): FlowGraph {
  const { compiled, warnings } = analyze(flow)
  const nodes: FlowGraphNode[] = []
  const edges: FlowGraphEdge[] = []
  collect(compiled, [], nodes, edges)
  return { name: compiled.name, version: compiled.version, nodes, edges, warnings }
}

function collect(
  def: CompiledFlow,
  path: readonly string[],
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
): void {
  const starts = new Set(def.start)
  const children: Array<readonly [string, CompiledFlow]> = []
  for (const id of def.start) edges.push({ from: null, to: id, kind: 'start', path })
  for (const id of def.order) {
    const step = def.steps[id]
    if (step === undefined) continue
    nodes.push(toNode(step, path, starts.has(id)))
    if (step.next.kind === 'static') {
      for (const to of step.next.targets) edges.push({ from: id, to, kind: 'next', path })
    }
    if (step.dependsOn !== undefined) {
      const list = 'all' in step.dependsOn ? step.dependsOn.all : step.dependsOn.any
      for (const dep of list) edges.push({ from: dep, to: id, kind: 'dependsOn', path })
    }
    if (step.waitTimeout !== undefined) {
      edges.push({ from: id, to: step.waitTimeout.next, kind: 'timeout', path })
    }
    if (step.child !== undefined) children.push([id, step.child])
  }
  // A flow's own nodes/edges come first, then its child flows (in declaration order).
  for (const [id, child] of children) collect(child, [...path, id], nodes, edges)
}

/**
 * Compiled adapter names → the names the author wrote (`s.flow(child, { context, deps, output })`,
 * `s.final({ output })`, `s.task(run, { idempotent: fn })`).
 */
const AUTHORING_NAMES: Readonly<Record<string, string>> = {
  childContext: 'context',
  childDeps: 'deps',
  childOutput: 'output',
  finalOutput: 'output',
  idempotencyKey: 'idempotent',
}

function toNode(step: CompiledStep, path: readonly string[], start: boolean): FlowGraphNode {
  const hooks: string[] = []
  for (const [name, hook] of Object.entries(step.hooks)) {
    if (hook === undefined) continue
    if (name === 'on') {
      for (const event of Object.keys(step.hooks.on ?? {})) hooks.push(`on:${event}`)
    } else hooks.push(AUTHORING_NAMES[name] ?? name)
  }
  const timeout = step.timeoutMs ?? step.waitTimeout?.afterMs
  return {
    id: step.id,
    kind: step.kind,
    ...(step.label !== undefined ? { label: step.label } : {}),
    path,
    hooks,
    ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(step.next.kind === 'dynamic' ? { dynamicNext: true as const } : {}),
    ...(start ? { start: true as const } : {}),
  }
}
