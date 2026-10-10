/**
 * The one edge component: shape from `edgePath`, stroke / dash by edge kind (`next` solid,
 * `dependsOn` dashed, `timeout` dotted, `start` thin, `dynamic` dashed to the `?` port), an
 * arrow head per edge and a label chip when the model gave one.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import type { ModelEdgeKind } from '../layout/model'
import { edgePath } from './edge-path'
import type { DevtoolsEdge } from './to-react-flow'

const STYLE: Readonly<
  Record<ModelEdgeKind, { readonly stroke: string; readonly width: number; readonly dash?: string }>
> = {
  next: { stroke: 'var(--owd-edge)', width: 2 },
  dependsOn: { stroke: 'var(--owd-warn)', width: 2, dash: '7 4' },
  timeout: { stroke: 'var(--owd-accent-2)', width: 2, dash: '2 4' },
  start: { stroke: 'var(--owd-subtle)', width: 1.5 },
  dynamic: { stroke: 'var(--owd-subtle)', width: 1.5, dash: '4 4' },
}

function FlowEdgeView(props: EdgeProps<DevtoolsEdge>): ReactElement {
  const kind = props.data?.kind ?? 'next'
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
    bulge: kind === 'dependsOn',
  })
  const markerId = `owd-arrow-${props.id}`
  const label = props.data?.label
  return (
    <>
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
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill={style.stroke} />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        className="owd-edge"
        style={{ stroke: style.stroke, strokeWidth: style.width, strokeDasharray: style.dash }}
        markerEnd={`url(#${markerId})`}
      />
      {label !== undefined && (
        <EdgeLabelRenderer>
          <div
            className="owd-edge-label"
            data-kind={kind}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const FlowEdgeComponent = memo(FlowEdgeView)
