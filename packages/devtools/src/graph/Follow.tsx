/**
 * Keeps a graph readable. A graph that fits at a readable size is shown whole. A wider one is
 * drawn at a readable size around the steps that matter now: the ones running, waiting or
 * failed, or the ones that start the wizard when no run is shown.
 */

import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'
import type { StepStatusMap } from '../types'
import type { DevtoolsEdge, DevtoolsNode } from './to-react-flow'

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
    const all = flow.getNodes()
    const bounds = flow.getNodesBounds(all)
    const whole = Math.min(width / (bounds.width || 1), height / (bounds.height || 1)) * 0.94
    if (whole >= READABLE_ZOOM || focus === '') {
      void flow.fitView({ padding: 0.06, maxZoom: 1.25, duration: 200 })
      return
    }
    const ids = new Set(focus.split('\n'))
    const focused = all.filter((node) => ids.has(node.id))
    // The steps the focus leads to come along when they fit, so the view shows where the run goes.
    const near = new Set(ids)
    for (const edge of flow.getEdges()) if (ids.has(edge.source)) near.add(edge.target)
    const around = all.filter((node) => near.has(node.id))
    const wide = flow.getNodesBounds(around)
    if (Math.min(width / wide.width, height / wide.height) * 0.9 >= READABLE_ZOOM) {
      void flow.fitView({ nodes: around, padding: 0.08, maxZoom: 1, duration: 250 })
      return
    }
    // Too wide even so: the focus goes to the left edge and what follows runs off to the right.
    const at = flow.getNodesBounds(focused)
    void flow.setViewport(
      {
        x: 28 - at.x * READABLE_ZOOM,
        y: height / 2 - (at.y + at.height / 2) * READABLE_ZOOM,
        zoom: READABLE_ZOOM,
      },
      { duration: 250 },
    )
  }, [flow, ready, width, height, count, focus])
  return null
}
