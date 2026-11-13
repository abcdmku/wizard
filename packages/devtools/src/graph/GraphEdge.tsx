/**
 * The one edge component: the route ELK laid out (`routePath`), or a shape from `edgePath` once a
 * card was dragged, dash and width by edge kind (`next` solid,
 * `route` dashed, `needs` solid, `fallback` dashed, `timeout` dotted, `start` thin, `dynamic`
 * dashed to the `?` port), an arrow head per edge and a label when the model gave one. The
 * colour comes from CSS (`--owd-edge-stroke`, set by kind and by `data-path`), so a path the
 * run took stands out from one it did not.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type InternalNode,
  useInternalNode,
} from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import { LABEL_BREAK, type Point } from '../layout/elk'
import type { ModelEdgeKind } from '../layout/model'
import { edgePath, routePath } from './edge-path'
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

const MOVED = 0.5

/** True while a node sits where the layout put it (it was not dragged). */
function still(node: InternalNode | undefined, at: Point | undefined): boolean {
  if (node === undefined || at === undefined) return false
  const p = node.internals.positionAbsolute
  return Math.abs(p.x - at.x) < MOVED && Math.abs(p.y - at.y) < MOVED
}

/**
 * A label that says two things (`optional need: by · times out after 48h`) takes one line for
 * each. The separator stays in the text for screen readers and copy, but is not shown.
 */
function Lines({ text }: { readonly text: string }): ReactElement {
  const [first, ...rest] = text.split(LABEL_BREAK)
  return (
    <>
      <span className="owd-edge-line">{first}</span>
      {rest.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one label never reorder
        <span key={i}>
          <span className="owd-edge-sep">{LABEL_BREAK}</span>
          <span className="owd-edge-line">{line}</span>
        </span>
      ))}
    </>
  )
}

function GraphEdgeView(props: EdgeProps<DevtoolsEdge>): ReactElement {
  const kind = props.data?.kind ?? 'next'
  const carried = props.data?.path === 'carried'
  const taken = carried ? 'taken' : props.data?.path
  const style = carried ? STYLE.needs : STYLE[kind]
  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)
  const route = props.data?.route
  const ends = props.data?.ends
  const routed =
    route !== undefined && still(sourceNode, ends?.source) && still(targetNode, ends?.target)
  const { path, labelX, labelY } = routed
    ? routePath(route.points, route.label)
    : edgePath({
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
          refX="9"
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
            <Lines text={label} />
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

export const GraphEdgeComponent = memo(GraphEdgeView)
