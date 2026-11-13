/**
 * Keyboard use of the graph, rendered inside `<ReactFlow>`: a step that gets focus and is not
 * wholly in view is brought into view, Enter or Space selects the focused step, Escape clears the
 * selection, and the React Flow attribution link stays visible but leaves the tab order.
 */

import { useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'
import { motion, PAD } from './Follow'

/**
 * Room kept between a focused step and the edge of the pane: less than the padding of a fitted
 * graph, so a step that shows whole is never moved.
 */
const MARGIN = Math.min(PAD.left, PAD.right, PAD.bottom) - 4

/** How far to move the view along one axis so `[start, end]` lies inside `[0, size]`. */
export function overflow(start: number, end: number, size: number, margin: number): number {
  if (end - start > size - 2 * margin) return margin - start
  if (start < margin) return margin - start
  if (end > size - margin) return size - margin - end
  return 0
}

function nodeIdOf(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement) || !target.classList.contains('react-flow__node'))
    return undefined
  return target.dataset.id
}

export function Keyboard({
  onSelect,
  onClear,
}: {
  readonly onSelect: (id: string) => void
  readonly onClear: () => void
}): null {
  const flow = useReactFlow()
  const dom = useStore((state) => state.domNode)

  useEffect(() => {
    if (dom === null) return
    for (const link of dom.querySelectorAll('.react-flow__attribution a'))
      link.setAttribute('tabindex', '-1')
    const onFocus = (event: FocusEvent) => {
      const id = nodeIdOf(event.target)
      const node = id === undefined ? undefined : flow.getInternalNode(id)
      if (node === undefined) return
      const { x, y, zoom } = flow.getViewport()
      const { width, height } = dom.getBoundingClientRect()
      const p = node.internals.positionAbsolute
      const w = node.measured.width ?? 0
      const h = Math.min(node.measured.height ?? 0, height / zoom - 2 * MARGIN)
      const x0 = p.x * zoom + x
      const y0 = p.y * zoom + y
      const dx = overflow(x0, x0 + w * zoom, width, MARGIN)
      const dy = overflow(y0, y0 + h * zoom, height, MARGIN)
      if (dx === 0 && dy === 0) return
      // Move only by what is out of view, so the rest of the graph stays where it was.
      void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: motion(200) })
    }
    const onKey = (event: KeyboardEvent) => {
      const id = nodeIdOf(event.target)
      if (id === undefined) return
      if (event.key === 'Escape') {
        onClear()
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onSelect(id)
    }
    dom.addEventListener('focusin', onFocus)
    dom.addEventListener('keydown', onKey)
    return () => {
      dom.removeEventListener('focusin', onFocus)
      dom.removeEventListener('keydown', onKey)
    }
  }, [dom, flow, onSelect, onClear])
  return null
}
