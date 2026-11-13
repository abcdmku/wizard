import { createContext, type ReactElement, useContext } from 'react'

/**
 * What the three window buttons in the top bar do, for a host that shows the UI as a window in
 * a page. Without it the top bar has no window buttons.
 */
export interface WindowControls {
  /** True while the UI fills the browser window. */
  readonly full: boolean
  readonly onClose: () => void
  readonly onMinimize: () => void
  /** Fill the browser window, or go back. */
  readonly onFull: () => void
}

export const WindowContext = createContext<WindowControls | undefined>(undefined)

/** The window buttons of the host, when it has them. */
export const useWindow = (): WindowControls | undefined => useContext(WindowContext)

/** Red, yellow and green: close, minimize, and fill the window. A glyph shows on hover. */
export function WindowDots({ controls }: { readonly controls: WindowControls }): ReactElement {
  return (
    <span className="dots">
      <button type="button" data-dot="close" aria-label="Close" onClick={controls.onClose}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" />
        </svg>
      </button>
      <button type="button" data-dot="min" aria-label="Minimize" onClick={controls.onMinimize}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.8 6h6.4" />
        </svg>
      </button>
      <button
        type="button"
        data-dot="full"
        aria-label={controls.full ? 'Exit full screen' : 'Full screen'}
        onClick={controls.onFull}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {controls.full ? (
            <path d="M5.2 2.6v2.6H2.6M6.8 9.4V6.8h2.6" />
          ) : (
            <path d="M3.4 6.4V3.4h3M8.6 5.6v3h-3" />
          )}
        </svg>
      </button>
    </span>
  )
}

/** The text button at the right end of the top bar that fills the window, or goes back. */
export function FullButton({ controls }: { readonly controls: WindowControls }): ReactElement {
  return (
    <button type="button" className="window-full" onClick={controls.onFull}>
      {controls.full ? 'Exit full screen' : 'Full screen'}
    </button>
  )
}
