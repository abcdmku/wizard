import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { Backend } from '../../../../dev/src/ui/backend'
import { localBackend } from '../../../../dev/src/ui/local'
import type { Route } from '../../../../dev/src/ui/nav'
import { DevPortal } from '../../../../dev/src/ui/portal'
import { useTheme } from '../../theme/theme-provider'
import { portals } from './configs'

interface Ready {
  readonly backend: Backend
  readonly open?: Route
}

/**
 * Whether the portal fills the window. While it does, the page behind does not scroll and
 * Escape leaves. `slot` keeps the portal's place in the page so the text does not jump.
 */
function useFull(): { full: boolean; hold: number | undefined; toggle: (height: number) => void } {
  const [hold, setHold] = useState<number>()
  const full = hold !== undefined
  useEffect(() => {
    if (!full) return
    const before = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setHold(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.documentElement.style.overflow = before
      window.removeEventListener('keydown', onKey)
    }
  }, [full])
  return { full, hold, toggle: (height) => setHold(full ? undefined : height) }
}

/** The height of the site header, which the UI pins its graph under. It differs on a phone. */
function useHeaderHeight(): number | undefined {
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    const header = document.querySelector('.site-header')
    if (header === null || typeof ResizeObserver === 'undefined') return
    const read = () => setHeight(Math.round(header.getBoundingClientRect().height))
    const watch = new ResizeObserver(read)
    watch.observe(header)
    read()
    return () => watch.disconnect()
  }, [])
  return height
}

/**
 * The dev UI of `openwizard dev`, running in the page. It is the same UI and the same run
 * store the dev server uses, with the wizards its page shows. A run is already started. In the page the UI
 * is as tall as its content, so only the page scrolls. "Full screen" gives it the whole window,
 * where it lays out as it does under `openwizard dev`, and the run carries over.
 */
export function Portal({ name }: { readonly name: string }) {
  const spec = portals[name]
  if (!spec) throw new Error(`Portal: no portal named '${name}'`)
  const { resolvedTheme } = useTheme()
  const [ready, setReady] = useState<Ready>()
  const figure = useRef<HTMLElement>(null)
  const { full, hold, toggle } = useFull()
  const top = useHeaderHeight()
  // Runs exist in the browser only, so nothing is created while the page is prerendered.
  useEffect(() => {
    let live = true
    const backend = localBackend(spec.config, spec.file)
    void (async () => {
      const first = (await backend.catalog()).wizards[0]
      const started =
        spec.autostart === false || first === undefined
          ? undefined
          : await backend.start({ wizard: first.name, input: first.exampleInput })
      if (!live) return
      setReady(
        started?.id === undefined
          ? { backend }
          : { backend, open: { page: 'run', id: started.id } },
      )
    })()
    return () => {
      live = false
    }
  }, [spec])
  return (
    <div className="portal-slot" style={hold === undefined ? undefined : { minHeight: hold }}>
      <figure
        ref={figure}
        className="portal not-prose"
        data-portal={name}
        data-full={full || undefined}
        style={top === undefined ? undefined : ({ '--ow-dev-top': `${top}px` } as CSSProperties)}
      >
        <figcaption className="portal-bar">
          {/* The three window buttons of a desktop app. They are a picture, not controls. */}
          <span className="portal-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="portal-title">
            <code>openwizard dev</code>
            <span className="portal-title-note">, running in this page</span>
          </span>
          <button
            type="button"
            className="portal-full"
            aria-pressed={full}
            onClick={() => toggle(figure.current?.offsetHeight ?? 0)}
          >
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
        </figcaption>
        <div className="portal-frame">
          {ready ? (
            <DevPortal
              backend={ready.backend}
              nav="memory"
              theme={resolvedTheme}
              scroll={full ? 'inside' : 'page'}
              className="portal-host"
              {...(ready.open === undefined ? {} : { open: ready.open })}
            />
          ) : (
            <div className="portal-loading" role="status">
              <div className="portal-loading-bar" />
              <div className="portal-loading-body">
                <span>Loading the dev UI</span>
              </div>
            </div>
          )}
        </div>
      </figure>
    </div>
  )
}
