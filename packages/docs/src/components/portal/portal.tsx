import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { Backend } from '../../../../dev/src/ui/backend'
import { localBackend } from '../../../../dev/src/ui/local'
import type { Route } from '../../../../dev/src/ui/nav'
import { DevPortal } from '../../../../dev/src/ui/portal'
import type { WindowControls } from '../../../../dev/src/ui/window-bar'
import { useTheme } from '../../theme/theme-provider'
import { portals } from './configs'
import { usePortalWindow } from './window'

interface Ready {
  readonly backend: Backend
  readonly open?: Route
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

/** How long the loading cover waits for the first graph before it lifts anyway. */
const COVER_MS = 2500

/**
 * True once the UI inside the figure has drawn its first graph. Until then the loading cover
 * stays over it, so a reader sees one change, from the cover to the whole UI, and none of the
 * half-built frames between.
 */
function useDrawn(figure: RefObject<HTMLElement | null>, ready: unknown): boolean {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    setDrawn(false)
    if (ready === undefined) return
    const started = performance.now()
    let frame = requestAnimationFrame(function look() {
      const root = figure.current?.querySelector('.portal-host')?.shadowRoot
      if (root?.querySelector('.react-flow__node') || performance.now() - started > COVER_MS)
        return setDrawn(true)
      frame = requestAnimationFrame(look)
    })
    return () => cancelAnimationFrame(frame)
  }, [figure, ready])
  return drawn
}

/**
 * The dev UI of `openwizard dev`, running in the page as a window. It is the same UI and the
 * same run store the dev server uses, with the wizards its page shows. A run is already started.
 * In the page the UI is as tall as its content, so only the page scrolls. The buttons in its top
 * bar work: green (or "Full screen") gives it the whole browser window, where it lays out as it
 * does under `openwizard dev`; yellow shrinks it to a button; red closes it, and it reopens
 * with a new run.
 */
export function Portal({ name }: { readonly name: string }) {
  const spec = portals[name]
  if (!spec) throw new Error(`Portal: no portal named '${name}'`)
  const { resolvedTheme } = useTheme()
  const [ready, setReady] = useState<Ready>()
  const figure = useRef<HTMLElement>(null)
  const win = usePortalWindow(figure)
  const { state, full, epoch, toggleFull, minimize, close } = win
  const top = useHeaderHeight()
  const drawn = useDrawn(figure, ready)
  const controls = useMemo<WindowControls>(
    () => ({ full, onClose: close, onMinimize: minimize, onFull: toggleFull }),
    [full, close, minimize, toggleFull],
  )
  // Runs exist in the browser only, so nothing is created while the page is prerendered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `epoch` starts a new run after a close.
  useEffect(() => {
    let live = true
    setReady(undefined)
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
  }, [spec, epoch])
  return (
    <div
      className="portal-slot"
      style={win.hold === undefined ? undefined : { minHeight: win.hold }}
    >
      {state !== 'open' && (
        <button type="button" className="portal-dock not-prose" onClick={win.restore}>
          <span className="portal-dock-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <code>openwizard dev</code>
          <span>{state === 'min' ? 'Restore' : 'Open again with a new run'}</span>
        </button>
      )}
      {state !== 'closed' && (
        <figure
          ref={figure}
          className="portal not-prose"
          data-portal={name}
          data-full={full || undefined}
          hidden={state === 'min'}
          style={top === undefined ? undefined : ({ '--ow-dev-top': `${top}px` } as CSSProperties)}
        >
          <div className="portal-frame" data-loading={drawn ? undefined : ''}>
            {ready && (
              <DevPortal
                backend={ready.backend}
                nav="memory"
                theme={resolvedTheme}
                scroll={full ? 'inside' : 'page'}
                controls={controls}
                className="portal-host"
                {...(ready.open === undefined ? {} : { open: ready.open })}
              />
            )}
            {!drawn && (
              <div className="portal-loading" role="status">
                <div className="portal-loading-bar" />
                <div className="portal-loading-body">
                  <span>Loading the dev UI</span>
                </div>
              </div>
            )}
          </div>
        </figure>
      )}
    </div>
  )
}
