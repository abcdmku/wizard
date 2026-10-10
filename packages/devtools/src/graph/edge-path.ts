/**
 * SVG paths for the three edge shapes: a self-loop drawn beside the node, a wide U-turn between
 * two handles on the same side (backwards edges), and the plain bezier otherwise. Returns the
 * path plus the label anchor.
 *
 * @packageDocumentation
 */

import { getBezierPath, Position } from '@xyflow/react'

export interface EdgeGeometry {
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
  readonly sourcePosition: Position
  readonly targetPosition: Position
  readonly selfLoop: boolean
  /** Different curvature for the two directions of a bidirectional pair. */
  readonly forward: boolean
  /** Bulge more (a `dependsOn` edge next to the `next` edge of the same pair stays visible). */
  readonly bulge?: boolean
}

export interface EdgePath {
  readonly path: string
  readonly labelX: number
  readonly labelY: number
}

const LOOP_SIZE = 56
const LOOP_OFFSET = 24
const U_DEPTH = 48

export function edgePath(g: EdgeGeometry): EdgePath {
  if (g.selfLoop) return selfLoop(g)
  const sameSide = g.sourcePosition === g.targetPosition
  if (sameSide && (g.sourcePosition === Position.Top || g.sourcePosition === Position.Bottom)) {
    return uTurn(g)
  }
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

/** A wide U below (bottom–bottom) or above (top–top) the cards, entering/leaving at an angle. */
function uTurn(g: EdgeGeometry): EdgePath {
  const below = g.sourcePosition === Position.Bottom
  const sign = below ? 1 : -1
  const distance = Math.abs(g.targetX - g.sourceX)
  const lean = distance * 0.05 * (g.targetX > g.sourceX ? 1 : -1)
  const c1x = g.sourceX + lean
  const c2x = g.targetX - lean
  const c1y = g.sourceY + sign * U_DEPTH
  const c2y = g.targetY + sign * U_DEPTH
  const path = `M ${g.sourceX},${g.sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${g.targetX},${g.targetY}`
  const midY = (g.sourceY + g.targetY) / 2
  return { path, labelX: (g.sourceX + g.targetX) / 2, labelY: midY + sign * U_DEPTH * 0.75 }
}
