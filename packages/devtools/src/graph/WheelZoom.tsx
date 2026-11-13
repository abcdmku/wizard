/**
 * Gentle zoom for Ctrl with the mouse wheel, rendered inside `<ReactFlow>`. React Flow
 * treats that as a pinch and zooms by a factor of four for one wheel notch; here one notch zooms
 * by 1.2 around the pointer, and a trackpad pinch, which sends many small steps, stays smooth.
 */

import { useReactFlow, useStore } from '@xyflow/react'
import { useEffect } from 'react'

/** The most one wheel event zooms: one notch of a mouse wheel. */
const NOTCH = 1.2
/** Zoom doubles for this many pixels of scroll, so a pinch of a few pixels moves a little. */
const DOUBLE = 100

/** The zoom factor for one wheel event, by how far it scrolls. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY
  return Math.min(NOTCH, Math.max(1 / NOTCH, 2 ** (-pixels / DOUBLE)))
}

/** Rendered inside `<ReactFlow>`: zooms by one notch for each Ctrl with the wheel. */
export function WheelZoom(): null {
  const flow = useReactFlow()
  const dom = useStore((state) => state.domNode)
  const minZoom = useStore((state) => state.minZoom)
  const maxZoom = useStore((state) => state.maxZoom)

  useEffect(() => {
    if (dom === null) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      const { x, y, zoom } = flow.getViewport()
      const next = Math.min(
        maxZoom,
        Math.max(minZoom, zoom * wheelFactor(event.deltaY, event.deltaMode)),
      )
      if (next === zoom) return
      const box = dom.getBoundingClientRect()
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      const k = next / zoom
      void flow.setViewport({ x: px - (px - x) * k, y: py - (py - y) * k, zoom: next })
    }
    // Capture, so React Flow's own pinch handler below never sees the event.
    dom.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => dom.removeEventListener('wheel', onWheel, { capture: true })
  }, [dom, flow, minZoom, maxZoom])
  return null
}
