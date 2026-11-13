/**
 * SVG paths for the edge shapes: the right-angled route ELK laid out (with rounded corners), a
 * self-loop drawn beside the node, a wide U-turn between two handles on the same side (backwards
 * edges), and the plain bezier when there is no route (a card was dragged). Returns the path plus
 * the label anchor.
 *
 * @packageDocumentation
 */

import { getBezierPath, Position } from '@xyflow/react'

interface EdgeGeometry {
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
  readonly sourcePosition: Position
  readonly targetPosition: Position
  readonly selfLoop: boolean
  /** Different curvature for the two directions of a bidirectional pair. */
  readonly forward: boolean
  /** Bulge more (a `needs` edge next to the `next` edge of the same pair stays visible). */
  readonly bulge?: boolean
}

interface EdgePath {
  readonly path: string
  readonly labelX: number
  readonly labelY: number
}

const LOOP_SIZE = 56
const LOOP_OFFSET = 24
const U_DEPTH = 48

export function edgePath(g: EdgeGeometry): EdgePath {
  if (g.selfLoop) return selfLoop(g)
  if (g.sourcePosition === g.targetPosition) return uTurn(g)
  const vertical =
    g.sourcePosition === Position.Top ||
    g.sourcePosition === Position.Bottom ||
    g.targetPosition === Position.Top ||
    g.targetPosition === Position.Bottom
  const base = vertical ? (g.forward ? 0.6 : 0.8) : g.forward ? 0.25 : 0.5
  const curvature = g.bulge === true ? base * 2.4 : base
  const [path, labelX, labelY] = getBezierPath({
    sourceX: g.sourceX,
    sourceY: g.sourceY,
    targetX: g.targetX,
    targetY: g.targetY,
    sourcePosition: g.sourcePosition,
    targetPosition: g.targetPosition,
    curvature,
  })
  return { path, labelX, labelY }
}

/** A loop leaving the right side and coming back a little lower. */
function selfLoop(g: EdgeGeometry): EdgePath {
  const x = g.sourceX + LOOP_OFFSET
  const y = g.sourceY
  const path = [
    `M ${x},${y}`,
    `C ${x + LOOP_SIZE},${y - LOOP_SIZE * 0.5} ${x + LOOP_SIZE},${y + LOOP_SIZE * 0.5} ${x},${y + LOOP_SIZE}`,
    `C ${x - LOOP_SIZE * 0.3},${y + LOOP_SIZE} ${x - LOOP_SIZE * 0.3},${y} ${x - 5},${y}`,
  ].join(' ')
  return { path, labelX: x + LOOP_SIZE / 2, labelY: y - LOOP_SIZE / 2 }
}

/**
 * A wide U beside the cards on the side both handles share (below, above, left or right),
 * entering and leaving at a slight angle.
 */
function uTurn(g: EdgeGeometry): EdgePath {
  const side = g.sourcePosition
  const vertical = side === Position.Top || side === Position.Bottom
  const sign = side === Position.Bottom || side === Position.Right ? 1 : -1
  // Work along `a` (the line the cards share) and `b` (out of the cards), then map back.
  const [sa, sb, ta, tb] = vertical
    ? [g.sourceX, g.sourceY, g.targetX, g.targetY]
    : [g.sourceY, g.sourceX, g.targetY, g.targetX]
  const lean = Math.abs(ta - sa) * 0.05 * (ta > sa ? 1 : -1)
  const pt = (a: number, b: number): string => (vertical ? `${a},${b}` : `${b},${a}`)
  const path = `M ${pt(sa, sb)} C ${pt(sa + lean, sb + sign * U_DEPTH)} ${pt(ta - lean, tb + sign * U_DEPTH)} ${pt(ta, tb)}`
  const labelA = (sa + ta) / 2
  const labelB = (sb + tb) / 2 + sign * U_DEPTH * 0.75
  return vertical
    ? { path, labelX: labelA, labelY: labelB }
    : { path, labelX: labelB, labelY: labelA }
}

const CORNER = 8

/** A polyline through `points` with each bend rounded off; the label sits at `label` or midway. */
export function routePath(
  points: readonly { readonly x: number; readonly y: number }[],
  label?: { readonly x: number; readonly y: number },
): EdgePath {
  const first = points[0]
  if (first === undefined) return { path: '', labelX: 0, labelY: 0 }
  let path = `M ${first.x},${first.y}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (p === undefined) continue
    const prev = points[i - 1] ?? p
    const next = points[i + 1]
    if (next === undefined) {
      path += ` L ${p.x},${p.y}`
      continue
    }
    const r = Math.min(CORNER, dist(prev, p) / 2, dist(p, next) / 2)
    const a = toward(p, prev, r)
    const b = toward(p, next, r)
    path += ` L ${a.x},${a.y} Q ${p.x},${p.y} ${b.x},${b.y}`
  }
  // ELK leaves room for the label beside the line, clear of cards and other labels.
  const mid = label ?? midpoint(points)
  return { path, labelX: mid.x, labelY: mid.y }
}

type Pt = { readonly x: number; readonly y: number }

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function toward(from: Pt, to: Pt, r: number): Pt {
  const d = dist(from, to) || 1
  return { x: from.x + ((to.x - from.x) * r) / d, y: from.y + ((to.y - from.y) * r) / d }
}

/** The point halfway along the polyline. */
function midpoint(points: readonly Pt[]): Pt {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1] as Pt, points[i] as Pt)
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Pt
    const b = points[i] as Pt
    const d = dist(a, b)
    if (d >= left) return toward(a, b, left)
    left -= d
  }
  return points[0] ?? { x: 0, y: 0 }
}
