/**
 * Which side an edge leaves and enters, from the relative position of its two boxes (same
 * coordinate space): forward edges run right → left, steep ones bottom → top (or top → bottom),
 * and an edge that has to go backwards leaves and enters on the SAME side (bottom–bottom or
 * top–top) so `GraphEdge` can draw it as a wide U-turn instead of crossing the cards.
 *
 * @packageDocumentation
 */

import type { LayoutDirection, Placement } from './elk'

/** Handle ids on every node: top / bottom / left / right. */
type Side = 't' | 'b' | 'l' | 'r'

interface HandlePair {
  readonly sourceHandle: Side
  readonly targetHandle: Side
}

const BACKWARD_DX = -50
const LEVEL_DY = 20
const STEEP_RATIO = 1.5

/** Pick the handles for an edge from box `source` to box `target`, for layers running right. */
function pickRight(source: Placement, target: Placement): HandlePair {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)
  if (dx < BACKWARD_DX) {
    // Backwards: same-side U-turn, below when the target is lower (or level), above otherwise.
    const side: Side = dy < -LEVEL_DY ? 't' : 'b'
    return { sourceHandle: side, targetHandle: side }
  }
  if (Math.abs(dy) > Math.abs(dx) * STEEP_RATIO) {
    return dy >= 0
      ? { sourceHandle: 'b', targetHandle: 't' }
      : { sourceHandle: 't', targetHandle: 'b' }
  }
  return { sourceHandle: 'r', targetHandle: 'l' }
}

const TURN: Readonly<Record<Side, Side>> = { t: 'l', b: 'r', l: 't', r: 'b' }

/** The same choice with the axes swapped, for layers running down. */
function turned(box: Placement): Placement {
  return { x: box.y, y: box.x, width: box.height, height: box.width }
}

/**
 * Pick the handles for an edge from box `source` to box `target`. With layers running down,
 * forward edges leave the bottom and enter the top, and backward ones turn on the right.
 */
export function pickHandles(
  source: Placement,
  target: Placement,
  direction: LayoutDirection = 'right',
): HandlePair {
  if (direction === 'right') return pickRight(source, target)
  const pair = pickRight(turned(source), turned(target))
  return { sourceHandle: TURN[pair.sourceHandle], targetHandle: TURN[pair.targetHandle] }
}
