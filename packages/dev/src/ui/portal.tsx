import devtoolsCss from '@openwizard/devtools/style.css?inline'
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App } from './app'
import { type Backend, BackendProvider } from './backend'
import { NavProvider, type Route, useHashNav, useMemoryNav } from './nav'
import pageCss from './page.css?inline'
import { type Scheme, SchemeContext } from './scheme'
import shellCss from './styles.css?inline'
import tablesCss from './tables.css?inline'

const CSS = [devtoolsCss, shellCss, pageCss, tablesCss].join('\n')

/** `light`, `dark`, or `system` to follow the device. */
export type PortalTheme = 'light' | 'dark' | 'system'

function useResolved(theme: PortalTheme): Scheme {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const read = () => setDark(query.matches)
    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])
  return theme === 'system' ? (dark ? 'dark' : 'light') : theme
}

/**
 * The dev UI as one element. It draws inside a shadow root, so its styles and the page's
 * styles cannot touch each other. Give the element a height: the UI fills it and scrolls
 * inside. `nav="hash"` keeps the route in the address bar and suits a page of its own.
 * `nav="memory"` suits a page that has other content.
 */
export function DevPortal(props: {
  readonly backend: Backend
  readonly nav?: 'hash' | 'memory'
  /** With `nav="memory"`, the wizard or run the UI opens on. */
  readonly open?: Route
  readonly theme?: PortalTheme
  readonly className?: string
  readonly style?: CSSProperties
}): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot>()
  useEffect(() => {
    const element = host.current
    if (element !== null) setRoot(element.shadowRoot ?? element.attachShadow({ mode: 'open' }))
  }, [])
  const hash = useHashNav(props.nav === 'hash')
  const memory = useMemoryNav(props.open)
  const scheme = useResolved(props.theme ?? 'system')
  return (
    <div ref={host} className={props.className} style={props.style}>
      {root !== undefined &&
        createPortal(
          <>
            <style>{CSS}</style>
            <div className="frame" data-theme={scheme}>
              <SchemeContext.Provider value={scheme}>
                <BackendProvider value={props.backend}>
                  <NavProvider value={hash ?? memory}>
                    <App />
                  </NavProvider>
                </BackendProvider>
              </SchemeContext.Provider>
            </div>
          </>,
          root,
        )}
    </div>
  )
}
