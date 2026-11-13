/** `usePaneSize(ref)` — the size of an element, kept current with a `ResizeObserver`. */

import { type RefObject, useEffect, useState } from 'react'

export interface PaneSize {
  readonly width: number
  readonly height: number
}

/** Rounded to 8px steps, so a scrollbar or a sub-pixel change does not lay the graph out again. */
const GRAIN = 8

export function usePaneSize(ref: RefObject<HTMLElement | null>): PaneSize {
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect === undefined) return
      const width = Math.round(rect.width / GRAIN) * GRAIN
      const height = Math.round(rect.height / GRAIN) * GRAIN
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
