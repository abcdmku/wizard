/**
 * `inspect(wizard)` — the wizard manifest: nodes, edges, JSON Schemas, prose, warnings and a
 * structural fingerprint, recursing into child wizards with `path`. Nothing here runs a hook.
 *
 * @packageDocumentation
 */

import type { AnyWizardDefinition } from '@openwizard/core'
import { isBoundary } from '../authoring/boundary'
import { analyze, type ManifestWarning } from '../authoring/compile'
import type { CompiledWizard } from '../authoring/compiled'
import { isRecord } from '../record'
import { fingerprint } from './fingerprint'
import { exclusiveJoinWarnings, skippedNeedWarnings } from './joins'
import { toJSONSchema } from './json-schema'
import { declaredTargets, prose, toNode } from './node'
import type { JSONSchema, Manifest, ManifestEdge, ManifestStep } from './types'

/**
 * Describe a wizard (compiles it if needed; throws `DEFINITION_INVALID` for a broken wizard).
 * Warnings include unreachable steps, blocked joins, a timeout or fallback target that needs the
 * step that starts it, navigation cycles and ambiguous sinks.
 * @public
 */
export function inspect(wizard: AnyWizardDefinition): Manifest {
  const { compiled, warnings } = analyze(wizard)
  const nodes: ManifestStep[] = []
  const edges: ManifestEdge[] = []
  const joinWarnings: ManifestWarning[] = []
  collect(compiled, [], nodes, edges, joinWarnings)
  const schemas = wizardSchemas(compiled)
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
  def: CompiledWizard,
  path: readonly string[],
  nodes: ManifestStep[],
  edges: ManifestEdge[],
  warnings: ManifestWarning[],
): void {
  const starts = new Set(def.start)
  const sinks = new Set(def.sinks)
  const raw = rawSteps(def)
  const children: Array<readonly [string, CompiledWizard]> = []
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
  warnings.push(...exclusiveJoinWarnings(def, path), ...skippedNeedWarnings(def, path))
  // A wizard's own nodes/edges come first, then its child wizards (in declaration order).
  for (const [id, child] of children) collect(child, [...path, id], nodes, edges, warnings)
}

/** The authoring step records of a compiled wizard (its `identity` is the wizard object). */
function rawSteps(def: CompiledWizard): Readonly<Record<string, unknown>> {
  const wizard: unknown = def.identity
  return isRecord(wizard) && isRecord(wizard.steps) ? wizard.steps : {}
}

/** JSON Schemas of the context (input side: what `create` accepts) and of every event payload. */
function wizardSchemas(def: CompiledWizard): Manifest['schemas'] {
  const wizard: unknown = def.identity
  if (!isRecord(wizard)) return { events: {} }
  const context = isBoundary(wizard.context) ? toJSONSchema(wizard.context, 'input') : undefined
  const events: Record<string, JSONSchema | undefined> = {}
  for (const name of Object.keys(def.events)) {
    const schema = isRecord(wizard.events) ? wizard.events[name] : undefined
    events[name] = isBoundary(schema) ? toJSONSchema(schema, 'input') : undefined
  }
  return { ...(context !== undefined ? { context } : {}), events }
}
