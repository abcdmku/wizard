/**
 * Which way a live run went, read from the statuses at both ends of each edge: the edges it
 * took, the ones it can no longer take, and the idle steps no way leads to any more.
 *
 * A `timeout` or `fallback` edge is the other way out of its source. The run takes it when the
 * source is skipped or fails (the wait timed out, the call failed) and its target then runs; it
 * can no longer take it once the source is done, unless the line also carries a need, since the
 * target then reads the source's output.
 *
 * @packageDocumentation
 */

import type { ModelEdge } from '../layout/model'
import type { StepStatusInfo, StepStatusMap } from '../types'
import type { DevtoolsEdge, EdgePathState, GraphOverlay } from './to-react-flow'

/** Statuses that mean the run reached a step. */
const REACHED = new Set(['active', 'done', 'failed', 'compensating', 'compensated', 'cancelled'])

/** The run reached the step: it has a reached status, or it ran and was then skipped. */
function reached(live: StepStatusInfo | undefined): boolean {
  if (live === undefined) return false
  return REACHED.has(live.status) || (live.status === 'skipped' && (live.attempt ?? 0) > 0)
}

/** The source took its other way out: a wait that timed out or a step that failed. */
const GAVE_UP = new Set(['skipped', 'failed'])

function alternate(
  edge: DevtoolsEdge,
  source: string | undefined,
  target: StepStatusInfo,
): EdgePathState | undefined {
  if (source !== undefined && GAVE_UP.has(source)) {
    if (reached(target)) return 'taken'
    return target.status === 'skipped' ? 'untaken' : undefined
  }
  if (source === 'done' && edge.data?.need !== true) return 'untaken'
  if (target.status === 'skipped') return 'untaken'
  // The wait finished in time and the target read its output: the run went along the need.
  if (source === 'done' && reached(target)) return 'carried'
  return undefined
}

function pathState(edge: DevtoolsEdge, statuses: StepStatusMap): EdgePathState | undefined {
  const target = statuses[edge.target]
  if (target === undefined) return undefined
  const source = edge.source.endsWith('#entry') ? 'done' : statuses[edge.source]?.status
  const kind = edge.data?.kind
  if (kind === 'timeout' || kind === 'fallback') return alternate(edge, source, target)
  if (source === 'skipped') return 'untaken'
  if (reached(target) && source !== undefined && source !== 'idle' && source !== 'active')
    return 'taken'
  // A plain `next` always starts its target, so a target skipped after it started (a wait that
  // timed out, a call that failed and fell back) was reached that way.
  if ((kind === 'next' || kind === 'start') && source === 'done' && target.status === 'skipped')
    return 'taken'
  if (target.status === 'skipped') return 'untaken'
  return undefined
}

/** The step is idle and will not start, so no line into it or out of it will be taken. */
function willNotStart(key: string, overlay: GraphOverlay): boolean {
  if (overlay.statuses[key]?.status !== 'idle') return false
  return overlay.stopped !== undefined || overlay.closed?.has(key) === true
}

/** Mark each edge the run took or can no longer take. Positions and handles are kept. */
export function applyEdgeOverlay(
  edges: readonly DevtoolsEdge[],
  overlay: GraphOverlay,
): DevtoolsEdge[] {
  return edges.map((edge) => {
    if (edge.data === undefined) return edge
    const dead = willNotStart(edge.source, overlay) || willNotStart(edge.target, overlay)
    const path = dead ? 'untaken' : pathState(edge, overlay.statuses)
    if (path === edge.data.path) return edge
    const { path: _old, ...rest } = edge.data
    return { ...edge, data: path === undefined ? rest : { ...rest, path } }
  })
}

/** Statuses after which a step's ordinary ways out lead nowhere. */
const GONE = new Set(['skipped', 'failed', 'cancelled', 'compensating', 'compensated'])

/** True when this edge can no longer start its target, or give it what it needs. */
function closed(edge: ModelEdge, statuses: StepStatusMap): boolean {
  if (edge.kind === 'start' || edge.kind === 'dynamic') return false
  const source = statuses[edge.source]?.status
  if (source === undefined || source === 'idle' || source === 'active') return false
  if (edge.kind === 'timeout') return source !== 'skipped'
  if (edge.kind === 'fallback') return !GAVE_UP.has(source)
  return GONE.has(source)
}

/** How a step's ways in decide whether it can still start. */
interface WaysIn {
  /** Needs it cannot run without: one closed is enough to stop it. */
  required: boolean
  /** Needs on any one of several steps, by label: a group with every one closed stops it. */
  readonly any: Map<string, boolean>
  /** Whether it has a need at all. A step with needs starts once they are met. */
  needs: boolean
  /** `next`, `route`, `timeout`, `fallback` and `start` edges into it, and whether one is open. */
  control: number
  controlOpen: boolean
}

function waysOf(map: Map<string, WaysIn>, key: string): WaysIn {
  let ways = map.get(key)
  if (ways === undefined) {
    ways = { required: false, any: new Map(), needs: false, control: 0, controlOpen: false }
    map.set(key, ways)
  }
  return ways
}

function stops(ways: WaysIn): boolean {
  if (ways.needs) return ways.required || [...ways.any.values()].some((allClosed) => allClosed)
  return ways.control > 0 && !ways.controlOpen
}

/**
 * The idle steps that can no longer start. A step with needs cannot start once a need it
 * cannot run without is closed, or every step of an `any` need is. A step without needs cannot
 * start once every edge that starts it (`next`, `route`, `timeout`, `fallback`) is closed.
 * An edge is closed when its source is skipped, failed, cancelled or undone, and a `timeout` or
 * `fallback` edge also once its source is done (the wait finished in time, the step succeeded).
 * A `start` edge and an optional need never close.
 */
export function closedSteps(
  edges: readonly ModelEdge[],
  statuses: StepStatusMap,
): ReadonlySet<string> {
  const byTarget = new Map<string, WaysIn>()
  for (const edge of edges) {
    if (statuses[edge.target]?.status !== 'idle' || edge.kind === 'dynamic') continue
    const ways = waysOf(byTarget, edge.target)
    const shut = closed(edge, statuses)
    if (edge.kind !== 'needs') {
      ways.control += 1
      ways.controlOpen ||= !shut
      continue
    }
    ways.needs = true
    const label = edge.label ?? ''
    // A step runs without an optional need, so an optional need never holds it back.
    if (label.startsWith('optional')) continue
    if (label.startsWith('any')) ways.any.set(label, (ways.any.get(label) ?? true) && shut)
    else ways.required ||= shut
  }
  return new Set([...byTarget].flatMap(([key, ways]) => (stops(ways) ? [key] : [])))
}
