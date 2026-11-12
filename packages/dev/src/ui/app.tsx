import { type ReactElement, useEffect, useState } from 'react'
import type { RunSummary } from '../wire'
import { useBackend, useServer } from './backend'
import { shortId, span } from './format'
import { Go, useNav } from './nav'
import { RunPage } from './run-page'
import { WizardPage } from './wizard-page'

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
    <Go className="nav-item" to={{ page: 'run', id: run.id }} current={props.active}>
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
    </Go>
  )
}

/** The dev UI: the wizards and runs on the left, one wizard or one run on the right. */
export function App(): ReactElement {
  const backend = useBackend()
  const server = useServer()
  const nav = useNav()
  const { route } = nav
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
    if (route.page === 'home' && first !== undefined) nav.go({ page: 'wizard', name: first.name })
  }, [route.page, first, nav])

  const wizard =
    route.page === 'wizard' ? wizards.find((item) => item.name === route.name) : undefined
  const { reload } = backend

  return (
    <div className="shell">
      <header className="top">
        <strong>OpenWizard</strong>
        <span className="tag">dev</span>
        <span className="quiet entry" title={catalog?.entry}>
          {catalog?.entry.split(/[/\\]/).slice(-2).join('/')}
        </span>
        <span className="spacer" />
        {backend.place === 'server' && (
          <span className="quiet">
            {server.connected ? 'Watching for changes' : 'Reconnecting…'}
          </span>
        )}
        {reload !== undefined && (
          <button type="button" onClick={() => void reload().then(server.refresh)}>
            Reload
          </button>
        )}
      </header>

      <nav className="side" aria-label="Wizards and runs">
        <h2>Wizards</h2>
        {wizards.map((item) => (
          <Go
            key={item.name}
            className="nav-item"
            to={{ page: 'wizard', name: item.name }}
            current={route.page === 'wizard' && route.name === item.name}
          >
            <span className="nav-main">{item.name}</span>
            <span className="quiet">
              {item.manifest.nodes.filter((node) => node.path.length === 0).length} steps
            </span>
          </Go>
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
        {runs.length === 0 && <p className="quiet pad">None yet.</p>}
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
          <p className="quiet">No wizard named {route.name} is loaded.</p>
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
