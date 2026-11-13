/**
 * Fitting the whole graph in view. The box to fit holds the steps and the edge labels, since a
 * label can stick out past the cards (a long label on a narrow graph), and the fit button of the
 * zoom controls fits that same box. Rendered inside `<ReactFlow>`.
 */

import { ControlButton, Controls, type Rect, useReactFlow, useStoreApi } from '@xyflow/react'
import { type ReactElement, useCallback } from 'react'
import { labelSize } from '../layout/elk'
import { fitZoom, MAX_FIT_ZOOM, motion, PAD } from './Follow'
import type { DevtoolsEdge, DevtoolsNode } from './to-react-flow'

/** The box around `nodesBox` (the steps) and every edge label, in flow coordinates. */
export function wholeBox(nodesBox: Rect, edges: readonly DevtoolsEdge[]): Rect {
  let x0 = nodesBox.x
  let y0 = nodesBox.y
  let x1 = nodesBox.x + nodesBox.width
  let y1 = nodesBox.y + nodesBox.height
  for (const edge of edges) {
    const at = edge.data?.route?.label
    const text = edge.data?.label
    if (at === undefined || text === undefined) continue
    const size = labelSize(text)
    x0 = Math.min(x0, at.x - size.width / 2)
    x1 = Math.max(x1, at.x + size.width / 2)
    y0 = Math.min(y0, at.y - size.height / 2)
    y1 = Math.max(y1, at.y + size.height / 2)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The viewport that shows `box` whole and centred, no larger than `MAX_FIT_ZOOM`. */
export function fitBox(
  box: Rect,
  pane: { readonly width: number; readonly height: number },
): { x: number; y: number; zoom: number } {
  const zoom = Math.min(MAX_FIT_ZOOM, fitZoom(box, pane))
  const roomX = pane.width - PAD.left - PAD.right
  const roomY = pane.height - PAD.top - PAD.bottom
  return {
    x: PAD.left + (roomX - box.width * zoom) / 2 - box.x * zoom,
    y: PAD.top + (roomY - box.height * zoom) / 2 - box.y * zoom,
    zoom,
  }
}

/** Moves the view to show the whole graph, labels included, over `duration` milliseconds. */
export function useFitWhole(): (duration: number) => void {
  const flow = useReactFlow<DevtoolsNode, DevtoolsEdge>()
  const store = useStoreApi<DevtoolsNode, DevtoolsEdge>()
  return useCallback(
    (duration: number) => {
      const { width, height } = store.getState()
      const nodes = flow.getNodes()
      if (nodes.length === 0 || width === 0 || height === 0) return
      const box = wholeBox(flow.getNodesBounds(nodes), flow.getEdges())
      void flow.setViewport(fitBox(box, { width, height }), { duration: motion(duration) })
    },
    [flow, store],
  )
}

/** The zoom controls, whose fit button fits the steps and the edge labels. */
export function GraphControls(): ReactElement {
  const fit = useFitWhole()
  return (
    <Controls
      showInteractive={false}
      showFitView={false}
      position="top-right"
      orientation="horizontal"
      className="owd-controls"
    >
      <ControlButton
        onClick={() => fit(200)}
        className="react-flow__controls-fitview"
        title="fit view"
        aria-label="Fit View"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      </ControlButton>
    </Controls>
  )
}
