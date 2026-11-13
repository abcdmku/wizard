/**
 * Keyboard use of the graph, rendered inside `<ReactFlow>`: a step that gets focus and is not
 * wholly in view is brought into view, Enter or Space selects the focused step, and the React
 * Flow attribution link stays visible but leaves the tab order.
 */

import { useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'
import { motion } from './Follow'

/** Room kept between a focused step and the edge of the pane. */
const MARGIN = 24

function nodeIdOf(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement) || !target.classList.contains('react-flow__node'))
    return undefined
  return target.dataset.id
}

export function Keyboard({ onSelect }: { readonly onSelect: (id: string) => void }): null {
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
      const inside =
        x0 >= MARGIN &&
        y0 >= MARGIN &&
        x0 + w * zoom <= width - MARGIN &&
        y0 + h * zoom <= height - MARGIN
      if (inside) return
      void flow.setCenter(p.x + w / 2, p.y + h / 2, { zoom, duration: motion(200) })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const id = nodeIdOf(event.target)
      if (id === undefined) return
      event.preventDefault()
      onSelect(id)
    }
    dom.addEventListener('focusin', onFocus)
    dom.addEventListener('keydown', onKey)
    return () => {
      dom.removeEventListener('focusin', onFocus)
      dom.removeEventListener('keydown', onKey)
    }
  }, [dom, flow, onSelect])
  return null
}
