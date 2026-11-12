import { WizardGraph } from '@openwizard/devtools'
import { type ReactElement, useState } from 'react'
import type { ActionResult, RunSummary, Services, WizardInfo } from '../wire'
import { api } from './api'
import { href, Status } from './app'
import { clock, shortId } from './format'
import { JsonEditor, JsonView, Refusal, useJsonDraft } from './json'
import { Outside } from './outside'

type Tab = 'outside' | 'steps' | 'schemas' | 'docs' | 'runs'

function StartForm({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const [draft, setDraft] = useJsonDraft(
    wizard.exampleInput,
    `${wizard.name}:${wizard.manifest.fingerprint}`,
  )
  const [services, setServices] = useState<Services>(wizard.hasDeps ? 'real' : 'manual')
  const [result, setResult] = useState<ActionResult>()
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    const started = await api.start({ wizard: wizard.name, input: draft.value, services })
    setBusy(false)
    setResult(started)
    if (started.ok && started.id !== undefined) location.hash = href.run(started.id)
  }

  return (
    <section className="card start">
      <h2>Start a run</h2>
      <JsonEditor draft={draft} onChange={setDraft} label="Input" />
      <div className="start-side">
        <fieldset className="choice">
          <legend>Service calls</legend>
          <label>
            <input
              type="radio"
              checked={services === 'manual'}
              onChange={() => setServices('manual')}
            />
            I answer each call
          </label>
          <label title={wizard.hasDeps ? undefined : 'The dev config gives this wizard no deps.'}>
            <input
              type="radio"
              checked={services === 'real'}
              disabled={!wizard.hasDeps}
              onChange={() => setServices('real')}
            />
            Use the configured services
          </label>
        </fieldset>
        <Refusal result={result} />
        <button
          type="button"
          className="primary"
          disabled={busy || draft.error !== undefined}
          onClick={() => void start()}
        >
          Start run
        </button>
      </div>
    </section>
  )
}

function Steps({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  return (
    <table>
      <thead>
        <tr>
          <th>Step</th>
          <th>Kind</th>
          <th>What it is for</th>
          <th>Needs</th>
          <th>Options</th>
        </tr>
      </thead>
      <tbody>
        {wizard.manifest.nodes.map((node) => {
          const options = [
            node.waitsFor !== undefined && `waits for ${node.waitsFor.join(', ')}`,
            node.retry !== undefined && 'retries',
            node.timeout !== undefined && `timeout ${node.timeout} ms`,
            node.sleep !== undefined &&
              `sleeps ${node.sleep === 'dynamic' ? '' : `${node.sleep} ms`}`,
            node.fallback !== undefined && `falls back to ${node.fallback}`,
            node.compensable === true && 'has an undo',
          ].filter((item): item is string => typeof item === 'string')
          return (
            <tr key={[...node.path, node.id].join('/')}>
              <td>
                <code>{[...node.path, node.id].join(' / ')}</code>
              </td>
              <td>{node.kind}</td>
              <td>{node.description ?? <span className="quiet">No description</span>}</td>
              <td>{Object.keys(node.needs ?? {}).join(', ')}</td>
              <td>{options.join(' · ')}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Schemas({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const { schemas, nodes } = wizard.manifest
  const views = nodes.filter((node) => node.input !== undefined)
  return (
    <div className="stack">
      <h3>Input</h3>
      <JsonView value={schemas.context ?? 'No schema'} />
      {Object.entries(schemas.events).map(([name, schema]) => (
        <div key={name}>
          <h3>
            Event <code>{name}</code>
          </h3>
          <JsonView value={schema ?? 'No JSON Schema for this validator'} />
        </div>
      ))}
      {views.map((node) => (
        <div key={node.id}>
          <h3>
            Form <code>{node.id}</code>
          </h3>
          <JsonView value={node.input} />
        </div>
      ))}
    </div>
  )
}

/** One wizard: its graph, a form to start a run, its steps, its schemas and its generated page. */
export function WizardPage(props: {
  readonly wizard: WizardInfo
  readonly runs: readonly RunSummary[]
}): ReactElement {
  const { wizard, runs } = props
  const [tab, setTab] = useState<Tab>('outside')
  const tabs: readonly [Tab, string][] = [
    ['outside', 'Outside the run'],
    ['steps', 'Steps'],
    ['schemas', 'Schemas'],
    ['docs', 'Generated page'],
    ['runs', `Runs (${runs.length})`],
  ]
  return (
    <>
      <div className="title">
        <h1>{wizard.name}</h1>
        <span className="quiet">version {wizard.version}</span>
      </div>
      {wizard.description !== undefined && <p className="lede">{wizard.description}</p>}
      {wizard.manifest.warnings.map((warning) => (
        <p key={`${warning.code}:${warning.message}`} className="warning">
          <code>{warning.code}</code> {warning.message}
        </p>
      ))}

      <StartForm wizard={wizard} />
      <section className="card graph">
        <WizardGraph graph={wizard.manifest} minimap={false} theme="system" />
      </section>

      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="card">
        {tab === 'outside' && <Outside wizard={wizard} />}
        {tab === 'steps' && <Steps wizard={wizard} />}
        {tab === 'schemas' && <Schemas wizard={wizard} />}
        {tab === 'docs' && <pre className="json">{wizard.markdown}</pre>}
        {tab === 'runs' &&
          (runs.length === 0 ? (
            <p className="quiet">No run of this wizard yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Waiting for you</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a href={href.run(run.id)}>
                        <code>{shortId(run.id)}</code>
                      </a>
                    </td>
                    <td>
                      <Status status={run.status} />
                    </td>
                    <td>{clock(run.createdAt)}</td>
                    <td>{run.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </section>
    </>
  )
}
