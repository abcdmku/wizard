import { type ReactElement, useEffect, useState } from 'react'
import { useBackend, useServer } from './backend'
import { useNav } from './nav'
import { RunPage } from './run-page'
import { Side } from './side'
import { WizardPage } from './wizard-page'

/** A coloured dot and the status of a run. */
export function Status({ status }: { readonly status: string }): ReactElement {
  return (
    <span className="status" data-status={status}>
      {status}
    </span>
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
  // The docs embed has neither, and in a narrow frame the bar then takes no room at all.
  const tools = backend.place === 'server' || reload !== undefined

  return (
    <div className="shell">
      {/* The shell's own rules. They can move into the list in portal.tsx; the order does not matter. */}
      <header className="topbar" data-tools={tools || undefined}>
        <strong className="brand">OpenWizard</strong>
        <span className="tag">dev</span>
        <span className="quiet entry" title={catalog?.entry}>
          {catalog?.entry.split(/[/\\]/).slice(-2).join('/')}
        </span>
        <span className="spacer" />
        {backend.place === 'server' && (
          <span className="live" data-on={server.connected} role="status">
            <span className="live-text">
              {server.connected ? 'Watching for changes' : 'Reconnecting…'}
            </span>
          </span>
        )}
        {reload !== undefined && (
          <button
            type="button"
            title="Load the wizard files again"
            onClick={() => void reload().then(server.refresh)}
          >
            Reload
          </button>
        )}
      </header>

      <Side wizards={wizards} runs={runs} route={route} now={now} />

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
