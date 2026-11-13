/**
 * When a step that has not started can no longer start, and why. The graph reads the same rule,
 * so the card and the step summary both say `not run` at the same moment.
 */

import type { Manifest } from '@openwizard/core/inspect'
import type { SnapshotLike } from '@openwizard/devtools'
import type { RunDetail } from '../wire'
import { span } from './format'
import { nodeOf, recordOf, splitKey } from './step-facts'

/** Run statuses in which no idle step starts any more. */
const STOPPED = new Set(['compensating', 'failed', 'halted', 'done', 'cancelled', 'compensated'])

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((part, index) => part === b[index])

/** The first step of the root run that failed, from the failed-step card or the snapshot. */
function failedStep(run: RunDetail): string | undefined {
  for (const item of run.pending) if (item.kind === 'failed') return item.step
  const steps = (run.snapshot as SnapshotLike | undefined)?.state.steps ?? {}
  for (const [id, record] of Object.entries(steps))
    if ((record as { status?: string } | undefined)?.status === 'failed') return id
  return undefined
}

/** Why the run itself keeps the step from starting. */
function runReason(run: RunDetail): string | undefined {
  const failed = failedStep(run)
  switch (run.status) {
    case 'failed':
      return failed === undefined ? 'The run failed.' : `The run failed at ${failed}.`
    case 'halted':
      return failed === undefined ? 'The run halted.' : `The run halted at ${failed}.`
    case 'compensating':
      return failed === undefined
        ? 'The run is undoing its work.'
        : `The run is undoing its work after ${failed} failed.`
    case 'cancelled':
      return 'The run was cancelled.'
    case 'done':
    case 'compensated':
      return 'The run finished without it.'
    default:
      return undefined
  }
}

/** Statuses after which a step's ordinary ways out lead nowhere. */
const GONE = new Set(['skipped', 'failed', 'cancelled', 'compensating', 'compensated'])
/** The source took its other way out: a wait that timed out or a step that failed. */
const GAVE_UP = new Set(['skipped', 'failed'])

type Edge = Manifest['edges'][number]

/**
 * Why one edge into a step can no longer start it, or `undefined` while it still can. The
 * graph closes edges by the same rule.
 */
function closedBy(
  edge: Edge,
  status: (step: string) => string | undefined,
  manifest: Manifest | undefined,
  path: readonly string[],
): string | undefined {
  if (edge.kind === 'start' || edge.from === null) return undefined
  // A step runs without an optional need, so an optional need never holds it back.
  if (edge.kind === 'needs' && edge.mode === 'optional') return undefined
  const from = edge.from
  const source = status(from)
  if (source === undefined || source === 'idle' || source === 'active') return undefined
  if (edge.kind === 'timeout') {
    if (source === 'skipped') return undefined
    const node = nodeOf(manifest, [...path, from].join('/'))
    const verb = (node?.waitsFor?.length ?? 0) > 0 ? 'was answered' : 'finished'
    return node?.timeout === undefined
      ? `${from} ${verb} before it timed out.`
      : `${from} ${verb} before its ${span(node.timeout)} timeout.`
  }
  if (edge.kind === 'fallback')
    return GAVE_UP.has(source) ? undefined : `${from} did not fail, so its fallback was not needed.`
  if (!GONE.has(source)) return undefined
  if (source === 'skipped') return `${from} was skipped, so nothing leads here.`
  if (source === 'failed') return `${from} failed, so nothing leads here.`
  if (source === 'cancelled') return `${from} was cancelled, so nothing leads here.`
  return `${from} was undone, so nothing leads here.`
}

/**
 * Why a step that has not started can no longer start, as a sentence, or `undefined` while it
 * still can. `key` is the step's key (`shipping/street` inside a child), and the caller checks
 * that the step is idle. The graph says `not run` on the same steps.
 *
 * - A step whose every way in is closed cannot start: a `timeout` edge closes once its wait
 *   was answered, a `fallback` edge once its step finished without failing, and any other edge
 *   once its step was skipped, failed, cancelled or undone. A `start` edge and an optional need
 *   never close. A timeout or fallback that did not fire is the reason given first.
 * - In a run that is undoing, failed, halted or has ended, no idle step starts.
 */
export function notRunWhy(
  run: RunDetail,
  manifest: Manifest | undefined,
  key: string,
): string | undefined {
  const { path, id } = splitKey(key)
  const where = path.filter((part) => !/^\d+$/.test(part))
  const into = (manifest?.edges ?? []).filter(
    (edge) => edge.to === id && samePath(edge.path, where),
  )
  const status = (step: string) =>
    recordOf(run.snapshot as SnapshotLike, [...path, step].join('/'))?.status
  const reasons = into.map((edge) => closedBy(edge, status, manifest, path))
  const closed = into.length > 0 && reasons.every((reason) => reason !== undefined)
  // A timeout or fallback that did not fire says the most, even after the run ended.
  const special = into.findIndex((edge) => edge.kind === 'timeout' || edge.kind === 'fallback')
  if (closed && special >= 0) return reasons[special]
  if (STOPPED.has(run.status)) return runReason(run)
  return closed ? reasons[0] : undefined
}
