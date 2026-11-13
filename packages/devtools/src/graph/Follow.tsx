/**
 * Keeps a graph readable. A graph that fits at a readable size is shown whole. A wider one is
 * drawn at a readable size around the steps that matter now: the ones running, waiting or
 * failed, or the ones that start the wizard when no run is shown.
 */

import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'
import type { StepStatusMap } from '../types'
import type { DevtoolsEdge, DevtoolsNode } from './to-react-flow'

/** Room around the steps when the whole graph is fitted. The top leaves room for the controls. */
export const FIT_PADDING = { top: '44px', right: '20px', bottom: '24px', left: '20px' } as const
const PAD = { top: 44, right: 20, bottom: 24, left: 20 } as const

/** Below this zoom the name of a step is too small to read. */
export const READABLE_ZOOM = 0.8

const LIVE = new Set(['active', 'failed', 'compensating'])

/**
 * The ids of the nodes to centre on: the steps that are running, waiting or failed. With none,
 * the steps that start the wizard, and with a finished run, the steps that finished last.
 */
export function focusOf(
  nodes: readonly Pick<DevtoolsNode, 'id' | 'type' | 'data'>[],
  statuses: StepStatusMap,
): readonly string[] {
  const steps = nodes.filter((node) => node.type === 'step')
  const live = steps.filter((node) => LIVE.has(statuses[node.id]?.status ?? ''))
  if (live.length > 0) return live.map((node) => node.id)
  const started = steps.some((node) => statuses[node.id] !== undefined)
  if (!started)
    return steps
      .filter((node) => 'step' in node.data && node.data.step.start === true)
      .map((node) => node.id)
  const done = steps.filter((node) => statuses[node.id]?.status === 'done')
  return done.slice(-1).map((node) => node.id)
}

/** Rendered inside `<ReactFlow>`. Moves the view when the layout or the focus changes. */
export function Follow({ statuses }: { readonly statuses: StepStatusMap }): null {
  const flow = useReactFlow<DevtoolsNode, DevtoolsEdge>()
  const ready = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const count = useStore((state) => state.nodes.length)
  const focus = ready ? focusOf(flow.getNodes(), statuses).join('\n') : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` moves the view when a child run adds nodes
  useEffect(() => {
    if (!ready || width === 0 || height === 0) return
    const roomX = width - PAD.left - PAD.right
    const roomY = height - PAD.top - PAD.bottom
    const fits = (box: { width: number; height: number }) =>
      Math.min(roomX / (box.width || 1), roomY / (box.height || 1)) >= READABLE_ZOOM
    const all = flow.getNodes()
    if (focus === '' || fits(flow.getNodesBounds(all))) {
      void flow.fitView({ padding: FIT_PADDING, maxZoom: 1.25, duration: 200 })
      return
    }
    const ids = new Set(focus.split('\n'))
    const focused = all.filter((node) => ids.has(node.id))
    // The steps the focus leads to come along when they fit, so the view shows where the run
    // goes, and so does the child wizard a focused step sits in, so its name stays in sight.
    // With room to spare, the steps that led to the focus come too.
    const near = new Set(ids)
    const before = new Set(ids)
    for (const edge of flow.getEdges()) {
      if (ids.has(edge.source)) near.add(edge.target)
      if (ids.has(edge.target)) before.add(edge.source)
    }
    const parents = new Set(focused.map((node) => node.parentId))
    const wide = all.filter(
      (node) => near.has(node.id) || before.has(node.id) || parents.has(node.id),
    )
    const around = all.filter((node) => near.has(node.id))
    const framed = all.filter((node) => near.has(node.id) || parents.has(node.id))
    const inner = all.filter((node) => ids.has(node.id) || parents.has(node.id))
    for (const nodes of [wide, framed, inner, around, focused]) {
      if (!fits(flow.getNodesBounds(nodes))) continue
      void flow.fitView({ nodes, padding: FIT_PADDING, maxZoom: 1, duration: 250 })
      return
    }
    // Too wide even so: the focus goes to the left edge and what follows runs off to the right.
    // A focus taller than the view keeps its top in sight rather than cutting both ends.
    const at = flow.getNodesBounds(focused)
    const tall = at.height * READABLE_ZOOM > roomY
    void flow.setViewport(
      {
        x: PAD.left + 8 - at.x * READABLE_ZOOM,
        y: tall
          ? PAD.top - at.y * READABLE_ZOOM
          : PAD.top + roomY / 2 - (at.y + at.height / 2) * READABLE_ZOOM,
        zoom: READABLE_ZOOM,
      },
      { duration: 250 },
    )
  }, [flow, ready, width, height, count, focus])
  return null
}
