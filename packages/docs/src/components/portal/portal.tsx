import { useEffect, useState } from 'react'
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
 * The dev UI of `openwizard dev`, running in the page. It is the same UI and the same run
 * store the dev server uses, with the wizards its page shows. A run is already started, and
 * the list above the UI says what to do in it to see the point of the page.
 */
export function Portal({ name }: { readonly name: string }) {
  const spec = portals[name]
  if (!spec) throw new Error(`Portal: no portal named '${name}'`)
  const { resolvedTheme } = useTheme()
  const [ready, setReady] = useState<Ready>()
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
    <figure className="portal not-prose" data-portal={name}>
      <figcaption className="portal-tries">
        <span className="portal-tries-label">Try it</span>
        <ol>
          {spec.tries.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </figcaption>
      <div className="portal-frame">
        {ready ? (
          <DevPortal
            backend={ready.backend}
            nav="memory"
            theme={resolvedTheme}
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
  )
}
