/**
 * The eight (invisible) connection points every graph node exposes — a source and a target
 * handle on each side, ids `t` / `b` / `l` / `r` — so `pickHandles` can route an edge out of
 * and into any side.
 */

import { Handle, Position } from '@xyflow/react'
import type { ReactElement } from 'react'

const SIDES = [
  ['t', Position.Top],
  ['b', Position.Bottom],
  ['l', Position.Left],
  ['r', Position.Right],
] as const

export function Handles(): ReactElement {
  return (
    <>
      {SIDES.map(([id, position]) => (
        <Handle key={`t-${id}`} type="target" position={position} id={id} isConnectable={false} />
      ))}
      {SIDES.map(([id, position]) => (
        <Handle key={`s-${id}`} type="source" position={position} id={id} isConnectable={false} />
      ))}
    </>
  )
}
