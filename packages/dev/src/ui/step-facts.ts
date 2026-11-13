import type { Manifest } from '@openwizard/core/inspect'
import type { SnapshotLike } from '@openwizard/devtools'

/** A step of the manifest. */
export type ManifestNode = Manifest['nodes'][number]

/** The fields of a stored step record the run page reads. The rest stays in "Raw record". */
export interface StepRecordView {
  readonly kind?: string
  readonly status?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly error?: {
    readonly message?: string
    readonly kind?: string
    readonly name?: string
    readonly attempt?: number
  }
  readonly skipReason?: string
  readonly attempt?: number
  /** When the step last started, on the run's clock. */
  readonly enteredAt?: number
  /** When the step last settled: done, failed, skipped or cancelled. */
  readonly endedAt?: number
  readonly retryAt?: number
  readonly deadline?: number
}

/** `shipping/street` as its run path and step id. Item indexes are kept in the path. */
export function splitKey(key: string): { readonly path: readonly string[]; readonly id: string } {
  const parts = key.split('/')
  const id = parts.pop() ?? key
  return { path: parts, id }
}

/** The manifest's entry for a step key. A child that runs per item has no index in the manifest. */
export function nodeOf(manifest: Manifest | undefined, key: string): ManifestNode | undefined {
  if (manifest === undefined) return undefined
  const { path, id } = splitKey(key)
  const where = path.filter((part) => !/^\d+$/.test(part))
  return manifest.nodes.find(
    (node) =>
      node.id === id &&
      node.path.length === where.length &&
      node.path.every((part, index) => part === where[index]),
  )
}

/** The stored record of a step, found by its key in the snapshot of the run or of a child. */
export function recordOf(snapshot: SnapshotLike, key: string): StepRecordView | undefined {
  const parts = key.split('/')
  const id = parts.pop() as string
  let node: SnapshotLike | undefined = snapshot
  for (let index = 0; index < parts.length && node !== undefined; index++) {
    const step = parts[index] as string
    const next: string | undefined = parts[index + 1]
    const mapped: string | undefined = Object.keys(node.children).find((address) =>
      address.includes(`/${encodeURIComponent(step)}/${next}/`),
    )
    if (node.children[step] === undefined && mapped !== undefined) {
      node = node.children[mapped]
      index += 1
    } else node = node.children[step]
  }
  return node?.state.steps[id] as StepRecordView | undefined
}

/** What a step does, as a verb phrase, from its manifest entry. */
export function kindOf(node: ManifestNode | undefined): string | undefined {
  if (node === undefined) return undefined
  if (node.kind === 'view') return 'Collects a form'
  if (node.kind === 'child')
    return node.child === undefined
      ? 'Runs a child wizard'
      : `Runs a child wizard (${node.child.name})`
  if (node.waitsFor !== undefined && node.waitsFor.length > 0)
    return `Waits for an event (${node.waitsFor.join(' or ')})`
  if (node.sleep !== undefined) return 'Sleeps'
  if (node.dynamicNext === true) return 'Chooses a branch'
  if (node.each !== undefined) return 'Runs work per item'
  return 'Runs work'
}

/** The fields of a run event the step panel reads. */
interface LooseEvent {
  readonly type: string
  readonly step?: string
  readonly path?: readonly string[]
  readonly next?: unknown
}

/** The steps a routing step chose the last time it finished, from the run's events. */
export function choiceOf(events: readonly unknown[], key: string): readonly string[] | undefined {
  const { path, id } = splitKey(key)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as LooseEvent
    if (event.type !== 'step.done' || event.step !== id) continue
    if ((event.path ?? []).join('/') !== path.join('/')) continue
    const next = event.next
    if (typeof next === 'string') return [next]
    if (Array.isArray(next)) return next.filter((item): item is string => typeof item === 'string')
    return undefined
  }
  return undefined
}

/**
 * One reason from `run.explain(step).reasons`, as what the step waits for: it reads after
 * "Waits for". `deps-unmet` is left to the caller, which joins the step names.
 */
export function reasonText(reason: string): string {
  const [code, detail] = reason.split(/:(.*)/s)
  switch (code) {
    case 'not-activated':
      return 'an earlier step to lead here'
    case 'not-current':
      return 'the form before it'
    case 'run-halted':
      return 'the failed step to be retried or skipped'
    case 'run-compensating':
      return 'undoing to finish'
    case 'when-pending':
      return 'its when check'
    case 'concurrency-limit':
      return 'other items to finish'
    case 'guard-false':
      return `its ${detail} guard to pass`
    default:
      return reason
  }
}
