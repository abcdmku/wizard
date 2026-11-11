/**
 * One manifest node from a compiled step (structure, hooks, policies) and its authoring record
 * (JSON Schemas of its boundaries).
 * @internal
 */

import { isBoundary } from '../authoring/boundary'
import { isStepRecord } from '../authoring/compile/shared'
import type { CompiledStep, RetryPolicy } from '../authoring/compiled'
import { isRunAdapter, RUN_ADAPTER } from '../authoring/run-adapter'
import type { AnyStep } from '../authoring/types'
import { toJSONSchema } from './json-schema'
import type { FlowGraphNode, GraphRetry, JSONSchema } from './types'

/** Where a step sits: its flow's path, whether it is an entry, and the flow's default retry. */
export interface NodeSite {
  readonly path: readonly string[]
  readonly start: boolean
  readonly sink: boolean
  readonly retry: RetryPolicy | undefined
}

export function toNode(step: CompiledStep, raw: unknown, site: NodeSite): FlowGraphNode {
  const record = isStepRecord(raw) ? raw : undefined
  const timeout = step.timeoutMs ?? step.waitTimeout?.afterMs
  const targets = declaredTargets(step)
  const waitsFor = Object.keys(step.hooks.waitFor ?? {})
  const retry =
    record?.config.run !== undefined || step.child !== undefined
      ? (step.retry ?? site.retry)
      : undefined
  const { input, output } = schemasOf(record)
  return {
    id: step.id,
    kind: step.kind,
    ...(step.label !== undefined ? { label: step.label } : {}),
    ...prose(step),
    path: site.path,
    hooks: hookNames(step, record),
    ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn } : {}),
    ...(step.needs !== undefined ? { needs: step.needs } : {}),
    ...(step.each !== undefined
      ? {
          each: {
            ...(Number.isFinite(step.each.concurrency)
              ? { concurrency: step.each.concurrency }
              : {}),
            ...(step.each.key !== undefined ? { keyed: true as const } : {}),
          },
        }
      : {}),
    ...(step.sleep !== undefined
      ? { sleep: typeof step.sleep === 'number' ? step.sleep : ('dynamic' as const) }
      : {}),
    ...(step.fallback !== undefined ? { fallback: step.fallback } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(step.next.kind === 'dynamic' ? { dynamicNext: true as const } : {}),
    ...(targets !== undefined ? { targets } : {}),
    ...(site.start ? { start: true as const } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(waitsFor.length > 0 ? { waitsFor } : {}),
    ...(site.sink ? { completes: true as const } : {}),
    ...(step.hooks.compensate !== undefined ? { compensable: true as const } : {}),
    ...(retry !== undefined ? { retry: retryFacts(retry) } : {}),
    ...(step.child !== undefined
      ? { child: { name: step.child.name, version: step.child.version } }
      : {}),
  }
}

/** Declared targets of a dynamic `next`, or `undefined`. */
export function declaredTargets(step: CompiledStep): readonly string[] | undefined {
  return step.next.kind === 'dynamic' ? step.next.targets : undefined
}

/** `description` / `meta` of a compiled step or flow, when set. */
export function prose({
  description,
  meta,
}: Pick<CompiledStep, 'description' | 'meta'>): Pick<FlowGraphNode, 'description' | 'meta'> {
  return {
    ...(description !== undefined ? { description } : {}),
    ...(meta !== undefined ? { meta } : {}),
  }
}

/** Compiled adapter names → the names the author wrote. */
const AUTHORING_NAMES: Readonly<Record<string, string>> = {
  childContext: 'context',
  childDeps: 'deps',
  childOutput: 'output',
}

function hookNames(step: CompiledStep, record: AnyStep | undefined): string[] {
  const hooks: string[] = []
  for (const [name, hook] of Object.entries(step.hooks)) {
    if (hook === undefined) continue
    if (name === 'run' && record?.config.run === undefined) continue
    if (name === 'on' || name === 'waitFor') {
      for (const event of Object.keys(step.hooks[name] ?? {})) hooks.push(`${name}:${event}`)
    } else hooks.push(AUTHORING_NAMES[name] ?? name)
  }
  if (step.each !== undefined) hooks.push('each')
  if (step.each?.key !== undefined) hooks.push('key')
  if (typeof step.sleep === 'function') hooks.push('sleep')
  return hooks
}

/** JSON Schemas of the boundaries a step declares (a view's `input`, an `output` or run adapter). */
function schemasOf(record: AnyStep | undefined): {
  readonly input?: JSONSchema | undefined
  readonly output?: JSONSchema | undefined
} {
  if (record === undefined) return {}
  const config = record.config
  if (record.kind === 'view') {
    return isBoundary(config.input)
      ? { input: toJSONSchema(config.input, 'input'), output: toJSONSchema(config.input, 'output') }
      : {}
  }
  const output =
    config.output ?? (isRunAdapter(config.run) ? config.run[RUN_ADAPTER].output : undefined)
  const schema = isBoundary(output) ? toJSONSchema(output, 'output') : undefined
  if (schema === undefined) return {}
  return {
    output:
      config.each === undefined
        ? schema
        : { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', items: schema },
  }
}

function retryFacts(policy: RetryPolicy): GraphRetry {
  return {
    retries: policy.retries,
    ...(policy.backoff !== undefined ? { backoff: policy.backoff } : {}),
    ...(policy.baseMs !== undefined ? { baseMs: policy.baseMs } : {}),
    ...(policy.factor !== undefined ? { factor: policy.factor } : {}),
    ...(policy.maxBackoffMs !== undefined ? { maxBackoffMs: policy.maxBackoffMs } : {}),
    ...(policy.jitter !== undefined ? { jitter: policy.jitter } : {}),
    ...(policy.when !== undefined ? { when: true as const } : {}),
  }
}
