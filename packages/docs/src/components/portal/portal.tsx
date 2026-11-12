import { useEffect, useState } from 'react'
import type { Backend } from '../../../../dev/src/ui/backend'
import { localBackend } from '../../../../dev/src/ui/local'
import { DevPortal } from '../../../../dev/src/ui/portal'
import { useTheme } from '../../theme/theme-provider'
import { portals } from './configs'

/**
 * The dev UI of `openwizard dev`, running in the page. It is the same UI and the same run
 * store the dev server uses, with the wizards its page shows. The reader starts a run, fills
 * in the forms, sends the events, answers the service calls and skips the timers.
 */
export function Portal({ name }: { readonly name: string }) {
  const spec = portals[name]
  if (!spec) throw new Error(`Portal: no portal named '${name}'`)
  const { resolvedTheme } = useTheme()
  const [backend, setBackend] = useState<Backend>()
  // Runs exist in the browser only, so nothing is created while the page is prerendered.
  useEffect(() => setBackend(localBackend(spec.config, spec.file)), [spec])
  return (
    <figure className="portal not-prose" data-portal={name}>
      {backend ? (
        <DevPortal backend={backend} nav="memory" theme={resolvedTheme} className="portal-host" />
      ) : (
        <p className="portal-loading">Loading the dev UI.</p>
      )}
    </figure>
  )
}
