/**
 * The two small round markers: a flow's entry point (▶, source of the `start` edges) and the
 * `?` port a dynamic `next` points to (its successors are only known at runtime).
 */

import type { NodeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import { Handles } from './Handles'
import type { MarkerNode } from './to-react-flow'

function MarkerNodeView({ data }: NodeProps<MarkerNode>): ReactElement {
  const entry = data.variant === 'entry'
  return (
    <>
      <Handles />
      <div
        className="owd-marker"
        data-variant={data.variant}
        title={entry ? 'entry point' : 'dynamic next: targets chosen at runtime'}
      >
        {entry ? '▶' : '?'}
      </div>
    </>
  )
}

export const MarkerNodeComponent = memo(MarkerNodeView)
