/**
 * Keeps a graph readable. A graph that fits at a readable size is shown whole, and so is every
 * graph in a narrow pane, such as a phone, where cutting steps off would hide the branches. A
 * larger one in a wide pane is drawn at a readable size around the steps that matter now: the
 * ones running, waiting or failed, or the ones that start the wizard when no run is shown. The
 * view then holds whole layers only, so no step is cut in half at an edge.
 *
 * Which of the two a graph gets depends only on the layout and the pane, never on the run, so a
 * graph shown whole stays whole as the run moves on.
 */

import { type Node, useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'
import type { LayoutDirection } from '../layout/elk'
import type { StepStatusMap } from '../types'
import { type Box, frameView } from './frame'
import type { DevtoolsEdge, DevtoolsNode } from './to-react-flow'

/** Room around the steps when the whole graph is fitted. The top leaves room for the controls. */
export const FIT_PADDING = { top: '44px', right: '20px', bottom: '20px', left: '20px' } as const
export const PAD = { top: 44, right: 20, bottom: 20, left: 20 } as const

/**
 * Below this zoom the name of a step is too small to read. Step ids, status words and edge
 * labels are drawn at 16px, so at this zoom they are 11.2px on screen.
 */
export const READABLE_ZOOM = 0.7

/** The largest zoom a fitted graph is drawn at: 16px text shows at 13.6px. */
export const MAX_FIT_ZOOM = 0.85

/** A pane narrower than this (a phone) always shows the whole graph. */
export const NARROW_PANE = 560

/** True for a pane too narrow to follow a run around a graph: it shows the whole graph. */
export function isNarrow(width: number): boolean {
  return width > 0 && width < NARROW_PANE
}

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

/** The zoom that shows a box of this size whole in a pane of this size. */
export function fitZoom(
  box: { readonly width: number; readonly height: number },
  pane: { readonly width: number; readonly height: number },
): number {
  const roomX = pane.width - PAD.left - PAD.right
  const roomY = pane.height - PAD.top - PAD.bottom
  return Math.min(roomX / (box.width || 1), roomY / (box.height || 1))
}

/** No animation for people who ask for less motion. */
export function motion(ms: number): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return ms
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms
}

function rootOf(id: string, byId: ReadonlyMap<string, Node>): string {
  let node = byId.get(id)
  while (node?.parentId !== undefined) node = byId.get(node.parentId)
  return node?.id ?? id
}

/** Rendered inside `<ReactFlow>`. Moves the view when the layout or the focus changes. */
export function Follow({
  statuses,
  direction,
  revision,
}: {
  readonly statuses: StepStatusMap
  readonly direction: LayoutDirection
  /** Changes each time the nodes are rebuilt from a new layout. */
  readonly revision: number
}): null {
  const flow = useReactFlow<DevtoolsNode, DevtoolsEdge>()
  const ready = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const count = useStore((state) => state.nodes.length)
  const focus = ready ? focusOf(flow.getNodes(), statuses).join('\n') : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` and `revision` move the view when the nodes change
  useEffect(() => {
    if (!ready || width === 0 || height === 0) return
    const pane = { width, height }
    const all = flow.getNodes()
    const whole =
      focus === '' || isNarrow(width) || fitZoom(flow.getNodesBounds(all), pane) >= READABLE_ZOOM
    if (whole) {
      void flow.fitView({ padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, duration: motion(200) })
      return
    }
    const byId = new Map<string, Node>(all.map((node) => [node.id, node]))
    const ids = focus.split('\n')
    const focused = all.filter((node) => ids.includes(node.id))
    const roots = new Set(ids.map((id) => rootOf(id, byId)))
    const boxes: Box[] = all
      .filter((node) => node.parentId === undefined)
      .map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? 0,
        height: node.height ?? 0,
      }))
    const own = boxes.filter((box) => roots.has(box.id))
    const ownFits = own.every((box) => fitZoom(box, pane) >= READABLE_ZOOM)
    if (ownFits) {
      const viewport = frameView({
        boxes,
        focus: [...roots],
        pane,
        padding: PAD,
        direction,
        floor: READABLE_ZOOM,
        maxZoom: MAX_FIT_ZOOM,
      })
      void flow.setViewport(viewport, { duration: motion(250) })
      return
    }
    // A child wizard too large to show whole: frame the focused steps inside it.
    if (fitZoom(flow.getNodesBounds(focused), pane) >= READABLE_ZOOM) {
      void flow.fitView({
        nodes: focused,
        padding: FIT_PADDING,
        maxZoom: MAX_FIT_ZOOM,
        duration: motion(250),
      })
      return
    }
    const at = flow.getNodesBounds(focused)
    void flow.setViewport(
      {
        x: PAD.left - at.x * READABLE_ZOOM,
        y: PAD.top - at.y * READABLE_ZOOM,
        zoom: READABLE_ZOOM,
      },
      { duration: motion(250) },
    )
  }, [flow, ready, width, height, count, focus, direction, revision])
  return null
}
