import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Open in the page, shrunk to a button, or closed until a reader opens it again. */
export type WindowState = 'open' | 'min' | 'closed'

/** The curve macOS windows move on: fast out of the gate, a long soft landing. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const ZOOM_MS = 420
const MIN_MS = 380
const CLOSE_MS = 170
/** A minimized window is this share of its size as it reaches its button. */
const SMALL = 0.06

const still = () =>
  typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches

/** Plays keyframes on the element and resolves when they end. With reduced motion it resolves at once. */
function play(element: HTMLElement, frames: Keyframe[], duration: number): Promise<void> {
  if (still() || typeof element.animate !== 'function') return Promise.resolve()
  return element.animate(frames, { duration, easing: EASE }).finished.then(
    () => undefined,
    () => undefined,
  )
}

const SHRUNK: Keyframe = { transform: `scale(${SMALL})`, opacity: 0, transformOrigin: 'top left' }
const WHOLE: Keyframe = { transform: 'none', opacity: 1, transformOrigin: 'top left' }

/** What the portal's window buttons do, and the state they leave it in. */
export interface PortalWindow {
  readonly state: WindowState
  readonly full: boolean
  /** The height the portal had in the page, kept while it fills the window so the text holds still. */
  readonly hold: number | undefined
  /** Counts reopenings. A closed window comes back with a new run. */
  readonly epoch: number
  readonly toggleFull: () => void
  readonly minimize: () => void
  readonly close: () => void
  readonly restore: () => void
}

/**
 * The window behaviour of a portal: the green button grows it to fill the browser window from
 * where it sits, the yellow one shrinks it into a button in the page, and the red one closes it.
 * While it fills the window the page behind does not scroll and Escape leaves.
 */
export function usePortalWindow(figure: RefObject<HTMLElement | null>): PortalWindow {
  const [state, setState] = useState<WindowState>('open')
  const [hold, setHold] = useState<number>()
  const [epoch, setEpoch] = useState(0)
  const full = hold !== undefined
  // Where the window was before the last change, for the motion that follows it.
  const from = useRef<DOMRect | 'small' | 'closed' | undefined>(undefined)

  const toggleFull = useCallback(() => {
    const element = figure.current
    if (element === null) return
    from.current = element.getBoundingClientRect()
    setHold((held) => (held === undefined ? element.offsetHeight : undefined))
  }, [figure])

  const leave = useCallback(
    (next: 'min' | 'closed') => {
      const element = figure.current
      if (element === null) return
      const frames =
        next === 'min' ? [WHOLE, SHRUNK] : [WHOLE, { transform: 'scale(0.97)', opacity: 0 }]
      void play(element, frames, next === 'min' ? MIN_MS : CLOSE_MS).then(() => {
        setHold(undefined)
        setState(next)
      })
    },
    [figure],
  )
  const minimize = useCallback(() => leave('min'), [leave])
  const close = useCallback(() => leave('closed'), [leave])
  const restore = useCallback(() => {
    from.current = state === 'min' ? 'small' : 'closed'
    if (state === 'closed') setEpoch((count) => count + 1)
    setState('open')
  }, [state])

  // After the change is on screen, move the window from where it was to where it is now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when `full` or `state` changes.
  useLayoutEffect(() => {
    const element = figure.current
    const was = from.current
    from.current = undefined
    if (element === null || was === undefined) return
    if (was === 'small') return void play(element, [SHRUNK, WHOLE], MIN_MS)
    if (was === 'closed')
      return void play(element, [{ transform: 'scale(0.97)', opacity: 0 }, WHOLE], CLOSE_MS)
    const now = element.getBoundingClientRect()
    if (now.width === 0 || now.height === 0) return
    const start = `translate(${was.left - now.left}px, ${was.top - now.top}px) scale(${was.width / now.width}, ${was.height / now.height})`
    element.dataset.zooming = ''
    void play(
      element,
      [
        { transform: start, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' },
      ],
      ZOOM_MS,
    ).then(() => delete element.dataset.zooming)
  }, [full, state])

  useEffect(() => {
    if (!full) return
    const before = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) toggleFull()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.documentElement.style.overflow = before
      window.removeEventListener('keydown', onKey)
    }
  }, [full, toggleFull])

  return { state, full, hold, epoch, toggleFull, minimize, close, restore }
}
