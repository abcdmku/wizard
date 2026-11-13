import { WizardGraph } from '@openwizard/devtools'
import { type KeyboardEvent, type ReactElement, useEffect, useId, useState } from 'react'
import type { RunSummary, WizardInfo } from '../wire'
import { Status } from './app'
import { clock, runTag } from './format'
import { Go, useNav } from './nav'
import { Outside, rowsOf } from './outside'
import { Schemas } from './schemas-tab'
import { useScheme } from './scheme'
import { StartForm } from './start-form'
import { Steps } from './steps-tab'

type Tab = 'steps' | 'outside' | 'schemas' | 'docs' | 'runs'

function Runs({ runs }: { readonly runs: readonly RunSummary[] }): ReactElement {
  const nav = useNav()
  if (runs.length === 0)
    return <p className="quiet">No runs yet. A run you start above shows here.</p>
  return (
    <table className="wz-runs">
      <thead>
        <tr>
          <th>Status</th>
          <th>Run</th>
          <th>Started</th>
          <th>Waiting for you</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr
            key={run.id}
            className="clickable"
            onClick={() => nav.go({ page: 'run', id: run.id })}
          >
            <td>
              <Status status={run.status} />
            </td>
            <td>
              <Go to={{ page: 'run', id: run.id }}>
                <code>{runTag(run.id)}</code>
              </Go>
            </td>
            <td className="quiet">{clock(run.createdAt).slice(0, 8)}</td>
            <td>
              {run.waiting > 0 ? (
                <span className="count">{run.waiting}</span>
              ) : (
                <span className="quiet">Nothing</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GeneratedPage({ markdown }: { readonly markdown: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="stack">
      <div className="wz-doc-head">
        <p>
          The Markdown that <code>toMarkdown(inspect(wizard))</code> prints. Put it in a README or
          give it to an agent.
        </p>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy Markdown'}
        </button>
        <span className="wz-sr" aria-live="polite">
          {copied ? 'Copied to the clipboard' : ''}
        </span>
      </div>
      <pre className="wz-markdown">{markdown}</pre>
    </div>
  )
}

const Alert = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2 1.5 13.5h13zM8 6.5v3.5M8 12v.01" />
  </svg>
)

/** One wizard: its graph, a form to start a run, its steps, its schemas and its generated page. */
export function WizardPage(props: {
  readonly wizard: WizardInfo
  readonly runs: readonly RunSummary[]
}): ReactElement {
  const { wizard, runs } = props
  const scheme = useScheme()
  const id = useId()
  const [tab, setTab] = useState<Tab>('steps')
  const { nodes, warnings } = wizard.manifest
  const tabs: readonly [Tab, string][] = [
    ['steps', `Steps (${nodes.length})`],
    ['outside', `Outside the run (${rowsOf(wizard).length})`],
    ['schemas', 'Schemas'],
    ['docs', 'Generated page'],
    ['runs', `Runs (${runs.length})`],
  ]
  const onKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    const index = tabs.findIndex(([value]) => value === tab)
    const next = tabs[(index + step + tabs.length) % tabs.length]
    if (next === undefined) return
    setTab(next[0])
    const list = event.currentTarget as HTMLElement
    list.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${next[0]}`)}`)?.focus()
  }
  return (
    <>
      <div className="title">
        <h1>{wizard.name}</h1>
        <span className="quiet">version {wizard.version}</span>
      </div>
      {wizard.description !== undefined && <p className="lede">{wizard.description}</p>}
      {warnings.length > 0 && (
        <ul className="wz-warnings" aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>
              <Alert />
              <span>
                <code>{warning.code}</code> {warning.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="card graph" aria-label="Steps">
        <WizardGraph graph={wizard.manifest} minimap={false} follow theme={scheme} />
      </section>
      <StartForm wizard={wizard} />

      <div className="tabs" role="tablist" aria-label="About this wizard" onKeyDown={onKey}>
        {tabs.map(([value, label]) => (
          <button
            key={value}
            id={`${id}-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        className="card wz-panel"
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
      >
        {tab === 'steps' && <Steps wizard={wizard} />}
        {tab === 'outside' && <Outside wizard={wizard} />}
        {tab === 'schemas' && <Schemas wizard={wizard} />}
        {tab === 'docs' && <GeneratedPage markdown={wizard.markdown} />}
        {tab === 'runs' && <Runs runs={runs} />}
      </section>
    </>
  )
}
