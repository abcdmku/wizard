/**
 * `useResize(position, initial)` — the size of a docked panel and the pointer-drag handler of
 * its edge (a bottom dock resizes vertically, a right dock horizontally), clamped to sane bounds.
 */

import { type PointerEvent as ReactPointerEvent, useCallback, useState } from 'react'

/**
 * Where the `<Devtools>` panel docks.
 * @public
 */
export type DockPosition = 'bottom' | 'right'

const MIN_SIZE = 160
const MAX_RATIO = 0.9

export function useResize(
  position: DockPosition,
  initial: number,
): { readonly size: number; readonly onHandlePointerDown: (event: ReactPointerEvent) => void } {
  const [size, setSize] = useState(initial)
  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      const startSize = size
      const startX = event.clientX
      const startY = event.clientY
      const max = (position === 'bottom' ? window.innerHeight : window.innerWidth) * MAX_RATIO
      const onMove = (move: PointerEvent): void => {
        const delta = position === 'bottom' ? startY - move.clientY : startX - move.clientX
        setSize(Math.min(max, Math.max(MIN_SIZE, startSize + delta)))
      }
      const onUp = (): void => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [position, size],
  )
  return { size, onHandlePointerDown }
}
