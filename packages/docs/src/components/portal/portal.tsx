import { useEffect, useId, useState } from 'react'
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

/** A `tries` line that starts with this is an idea to try, listed after the numbered steps. */
const IDEA = 'Idea: '

/**
 * What to do in the UI below: numbered steps in reading order, then ideas to try. On a phone it
 * folds to one line that opens on a tap.
 */
function Tries({ tries }: { readonly tries: readonly string[] }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const steps = tries.filter((line) => !line.startsWith(IDEA))
  const ideas = tries.filter((line) => line.startsWith(IDEA)).map((line) => line.slice(IDEA.length))
  const count = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`
  return (
    <figcaption className="portal-tries" data-open={open || undefined}>
      <span className="portal-tries-label">Try it</span>
      <button
        type="button"
        className="portal-tries-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Try it: {count}
        {ideas.length > 0 && ` and ${ideas.length} ${ideas.length === 1 ? 'idea' : 'ideas'}`}
      </button>
      <div className="portal-tries-body" id={id}>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {ideas.length > 0 && (
          <div className="portal-ideas">
            <span className="portal-ideas-label">Things to try</span>
            <ul>
              {ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </figcaption>
  )
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
      <Tries tries={spec.tries} />
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
