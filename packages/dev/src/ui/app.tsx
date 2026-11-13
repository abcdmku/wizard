import { type ReactElement, useEffect, useState } from 'react'
import { useBackend, useServer } from './backend'
import { useNav } from './nav'
import { RunPage } from './run-page'
import { Side } from './side'
import { runWord, wordTone } from './status-word'
import { FullButton, useWindow, WindowDots } from './window-bar'
import { WizardPage } from './wizard-page'

/**
 * A coloured dot and the status of a run in the run page's words (`runWord`). Pass `waiting`,
 * the number of things a person supplies, so a run stopped on you reads `waiting on you`, and
 * `retrying`, so a run waiting out a retry delay reads `retrying`. Pass
 * `word` to show a word from `stepWord` instead.
 */
export function Status(props: {
  readonly status?: string
  readonly waiting?: number
  /** True while a step waits out a retry delay (`RunSummary.retrying`). */
  readonly retrying?: boolean
  readonly word?: string
}): ReactElement {
  const word = props.word ?? runWord(props.status ?? '', props.waiting ?? 0, props.retrying)
  return (
    <span className="status" data-status={wordTone(word)}>
      {word}
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
  // With no tools and no window buttons, the bar takes no room in a narrow frame.
  const controls = useWindow()
  const tools = backend.place === 'server' || reload !== undefined || controls !== undefined

  return (
    <div className="shell">
      {/* The shell's own rules. They can move into the list in portal.tsx; the order does not matter. */}
      <header
        className="topbar"
        data-tools={tools || undefined}
        data-window={controls === undefined ? undefined : ''}
      >
        {controls !== undefined && <WindowDots controls={controls} />}
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
        {controls !== undefined && <FullButton controls={controls} />}
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
