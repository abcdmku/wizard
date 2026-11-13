/**
 * The one edge component: shape from `edgePath`, dash and width by edge kind (`next` solid,
 * `route` dashed, `needs` solid, `fallback` dashed, `timeout` dotted, `start` thin, `dynamic`
 * dashed to the `?` port), an arrow head per edge and a label when the model gave one. The
 * colour comes from CSS (`--owd-edge-stroke`, set by kind and by `data-path`), so a path the
 * run took stands out from one it did not.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import type { ModelEdgeKind } from '../layout/model'
import { edgePath } from './edge-path'
import type { DevtoolsEdge } from './to-react-flow'

const STYLE: Readonly<Record<ModelEdgeKind, { readonly width: number; readonly dash?: string }>> = {
  next: { width: 1.5 },
  route: { width: 1.5, dash: '6 4' },
  needs: { width: 1.5 },
  fallback: { width: 1.5, dash: '7 4' },
  timeout: { width: 1.5, dash: '2 4' },
  start: { width: 1.25 },
  dynamic: { width: 1.25, dash: '4 4' },
}

function GraphEdgeView(props: EdgeProps<DevtoolsEdge>): ReactElement {
  const kind = props.data?.kind ?? 'next'
  const taken = props.data?.path
  const style = STYLE[kind]
  const { path, labelX, labelY } = edgePath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    selfLoop: props.source === props.target,
    forward: props.source < props.target,
    bulge: kind === 'needs',
  })
  const markerId = `owd-arrow-${props.id}`
  const label = props.data?.label
  const width = taken === 'taken' ? style.width + 0.5 : style.width
  return (
    <g className="owd-edge-group" data-kind={kind} data-path={taken}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" className="owd-edge-arrow" />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        className="owd-edge"
        style={{
          stroke: 'var(--owd-edge-stroke)',
          strokeWidth: width,
          strokeDasharray: style.dash,
        }}
        markerEnd={`url(#${markerId})`}
      />
      {label !== undefined && (
        <EdgeLabelRenderer>
          <div
            className="owd-edge-label"
            data-kind={kind}
            data-path={taken}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

export const GraphEdgeComponent = memo(GraphEdgeView)
