import { type ReactElement, useId, useState } from 'react'
import type { ActionResult, Schema, Services, WizardInfo } from '../wire'
import { useBackend } from './backend'
import { ValueEditor } from './fields'
import { Refusal, useJsonDraft } from './json'
import { useNav } from './nav'

type Loose = {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, Loose>>
}

const SIMPLE = new Set(['string', 'number', 'integer', 'boolean'])

/** True when the input is one or two flat fields, so the fields and the button fit on one line. */
function isCompact(schema: Schema | undefined): boolean {
  const properties = (schema as Loose | undefined)?.properties
  if (properties === undefined) return false
  const values = Object.values(properties)
  return (
    values.length > 0 &&
    values.length <= 2 &&
    values.every(
      (property) =>
        Array.isArray(property.enum) ||
        (typeof property.type === 'string' && SIMPLE.has(property.type)),
    )
  )
}

function ServiceChoice(props: {
  readonly wizard: WizardInfo
  readonly value: Services
  readonly onChange: (value: Services) => void
}): ReactElement {
  const name = useId()
  const { services } = props.wizard
  const options: readonly [Services, string, string][] = [
    [
      'real',
      'Use the configured services',
      services.length === 0
        ? 'Calls go to the services in the dev config and answer on their own.'
        : `Calls to ${services.join(', ')} answer on their own. Other calls wait for you.`,
    ],
    [
      'manual',
      'I answer each call',
      'Every service call stops the run until you return a value or throw.',
    ],
  ]
  return (
    <fieldset className="wz-services">
      <legend>Service calls</legend>
      {options.map(([value, title, consequence]) => (
        <label key={value} className="wz-option">
          <input
            type="radio"
            name={name}
            checked={props.value === value}
            onChange={() => props.onChange(value)}
          />
          <span>
            <strong>{title}</strong>
            <span className="quiet">{consequence}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

const Play = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5 3.5v9l7-4.5z" />
  </svg>
)

/** The form that starts a run of one wizard: its input, who answers service calls, and Start run. */
export function StartForm({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const backend = useBackend()
  const nav = useNav()
  const [draft, setDraft] = useJsonDraft(
    wizard.exampleInput,
    `${wizard.name}:${wizard.manifest.fingerprint}`,
  )
  const [services, setServices] = useState<Services>(wizard.hasDeps ? 'real' : 'manual')
  const [result, setResult] = useState<ActionResult>()
  const [busy, setBusy] = useState(false)
  const compact = isCompact(wizard.manifest.schemas.context)

  const start = async () => {
    setBusy(true)
    const started = await backend.start({ wizard: wizard.name, input: draft.value, services })
    setBusy(false)
    setResult(started)
    if (started.ok && started.id !== undefined) nav.go({ page: 'run', id: started.id })
  }

  return (
    <section className="card wz-launch" aria-labelledby={`${wizard.name}-start`}>
      <header>
        <h2 id={`${wizard.name}-start`}>Start a run</h2>
        <p className="quiet">You play every person and system the run waits for.</p>
      </header>
      <form
        className="wz-launch-form"
        data-compact={compact || undefined}
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <div className="wz-input">
          <ValueEditor
            schema={wizard.manifest.schemas.context}
            draft={draft}
            onChange={setDraft}
            label="Input"
          />
        </div>
        <button
          type="submit"
          className="primary wz-go"
          disabled={busy || draft.error !== undefined}
        >
          <Play />
          {busy ? 'Starting' : 'Start run'}
        </button>
      </form>
      <Refusal result={result} />
      {wizard.hasDeps ? (
        <ServiceChoice wizard={wizard} value={services} onChange={setServices} />
      ) : (
        <p className="wz-hint">
          You answer every service call by hand. Add <code>deps</code> to the dev config to call
          real services instead.
        </p>
      )}
    </section>
  )
}
