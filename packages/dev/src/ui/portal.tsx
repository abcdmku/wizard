import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App } from './app'
import { type Backend, BackendProvider } from './backend'
import graphCss from './graph.css?inline'
import { NavProvider, useHashNav, useMemoryNav } from './nav'
import pageCss from './page.css?inline'
import shellCss from './styles.css?inline'
import tablesCss from './tables.css?inline'

const CSS = [shellCss, pageCss, tablesCss, graphCss].join('\n')

/** `light`, `dark`, or `system` to follow the device. */
export type PortalTheme = 'light' | 'dark' | 'system'

function useScheme(theme: PortalTheme): 'light' | 'dark' {
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
  const memory = useMemoryNav()
  const scheme = useScheme(props.theme ?? 'system')
  return (
    <div ref={host} className={props.className} style={props.style}>
      {root !== undefined &&
        createPortal(
          <>
            <style>{CSS}</style>
            <div className="frame" data-theme={scheme}>
              <BackendProvider value={props.backend}>
                <NavProvider value={hash ?? memory}>
                  <App />
                </NavProvider>
              </BackendProvider>
            </div>
          </>,
          root,
        )}
    </div>
  )
}
