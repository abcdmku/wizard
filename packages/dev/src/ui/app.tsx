import { type ReactElement, useEffect, useState } from 'react'
import type { RunSummary } from '../wire'
import { api, useServer } from './api'
import { shortId, span } from './format'
import { RunPage } from './run-page'
import { WizardPage } from './wizard-page'

type Route =
  | { readonly page: 'wizard'; readonly name: string }
  | { readonly page: 'run'; readonly id: string }
  | { readonly page: 'home' }

const parse = (hash: string): Route => {
  const [, page, ...rest] = hash.replace(/^#/, '').split('/')
  const value = decodeURIComponent(rest.join('/'))
  if (page === 'wizard' && value !== '') return { page: 'wizard', name: value }
  if (page === 'run' && value !== '') return { page: 'run', id: value }
  return { page: 'home' }
}

/** The address of a wizard page or a run page. */
export const href = {
  wizard: (name: string) => `#/wizard/${encodeURIComponent(name)}`,
  run: (id: string) => `#/run/${encodeURIComponent(id)}`,
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** A coloured dot and the status of a run. */
export function Status({ status }: { readonly status: string }): ReactElement {
  return (
    <span className="status" data-status={status}>
      {status}
    </span>
  )
}

function RunLink(props: {
  readonly run: RunSummary
  readonly active: boolean
  readonly now: number
}) {
  const { run } = props
  return (
    <a
      className="nav-item"
      href={href.run(run.id)}
      aria-current={props.active ? 'page' : undefined}
    >
      <span className="dot" data-status={run.status} />
      <span className="nav-main">
        {run.wizard} <span className="quiet">{shortId(run.id)}</span>
      </span>
      {run.waiting > 0 && (
        <span className="count" title="Waiting for you">
          {run.waiting}
        </span>
      )}
      <span className="quiet">{span(props.now - run.createdAt)}</span>
    </a>
  )
}

/** The dev UI: the wizards and runs on the left, one wizard or one run on the right. */
export function App(): ReactElement {
  const server = useServer()
  const route = useRoute()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { catalog, runs } = server
  const wizards = catalog?.wizards ?? []
  const first = wizards[0]
  // With nothing chosen, show the first wizard.
  useEffect(() => {
    if (route.page === 'home' && first !== undefined) location.replace(href.wizard(first.name))
  }, [route.page, first])

  const wizard =
    route.page === 'wizard' ? wizards.find((item) => item.name === route.name) : undefined

  return (
    <div className="shell">
      <header className="top">
        <strong>OpenWizard</strong>
        <span className="tag">dev</span>
        <span className="quiet entry" title={catalog?.entry}>
          {catalog?.entry.split(/[/\\]/).slice(-2).join('/')}
        </span>
        <span className="spacer" />
        <span className="quiet">{server.connected ? 'Watching for changes' : 'Reconnecting…'}</span>
        <button type="button" onClick={() => void api.reload().then(server.refresh)}>
          Reload
        </button>
      </header>

      <nav className="side" aria-label="Wizards and runs">
        <h2>Wizards</h2>
        {wizards.map((item) => (
          <a
            key={item.name}
            className="nav-item"
            href={href.wizard(item.name)}
            aria-current={route.page === 'wizard' && route.name === item.name ? 'page' : undefined}
          >
            <span className="nav-main">{item.name}</span>
            <span className="quiet">
              {item.manifest.nodes.filter((node) => node.path.length === 0).length} steps
            </span>
          </a>
        ))}
        {wizards.length === 0 && <p className="quiet pad">No wizard loaded.</p>}
        <h2>Runs</h2>
        {runs.map((run) => (
          <RunLink
            key={run.id}
            run={run}
            now={now}
            active={route.page === 'run' && route.id === run.id}
          />
        ))}
        {runs.length === 0 && <p className="quiet pad">Start a run from a wizard.</p>}
      </nav>

      <main className="main">
        {catalog?.error !== undefined && (
          <pre className="load-error" role="alert">
            {catalog.error}
          </pre>
        )}
        {route.page === 'wizard' && wizard !== undefined && (
          <WizardPage
            key={wizard.name}
            wizard={wizard}
            runs={runs.filter((run) => run.wizard === wizard.name)}
          />
        )}
        {route.page === 'wizard' && wizard === undefined && catalog !== undefined && (
          <p className="quiet">The entry file exports no wizard named {route.name}.</p>
        )}
        {route.page === 'run' && (
          <RunPage
            key={route.id}
            id={route.id}
            version={server.version(route.id)}
            wizards={wizards}
          />
        )}
      </main>
    </div>
  )
}
