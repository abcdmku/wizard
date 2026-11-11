import { FleetDemoTokens } from '@openwizard/fleet-shared'
import { type FormEvent, useState } from 'react'
import { Icon } from './Icon'

const accounts = [
  {
    name: 'Lakeshore Logistics',
    detail: 'Central dispatch · Chicago',
    token: FleetDemoTokens.lakeshore,
  },
  {
    name: 'Redwood Distribution',
    detail: 'West dispatch · Los Angeles',
    token: FleetDemoTokens.redwood,
  },
]

interface AuthScreenProps {
  message: string | undefined
  onAuthenticate: (token: string) => void
}

export function AuthScreen({ message, onAuthenticate }: AuthScreenProps) {
  const [token, setToken] = useState<string>(FleetDemoTokens.lakeshore)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onAuthenticate(token)
  }

  return (
    <main className="auth-page">
      <div className="auth-glow" />
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand-mark" aria-hidden="true">
          <Icon name="route" />
        </div>
        <p className="eyebrow">OpenWizard operations</p>
        <h1 id="auth-title">Fleet control</h1>
        <p className="auth-intro">
          Choose a seeded dispatcher account. The API resolves its tenant from the bearer token.
        </p>
        {message ? (
          <div className="inline-alert" role="alert">
            <Icon name="alert" />
            <span>{message}</span>
          </div>
        ) : null}
        <form onSubmit={submit}>
          <fieldset className="account-list">
            <legend>Dispatch account</legend>
            {accounts.map((account) => (
              <label className="account-option" key={account.token}>
                <input
                  checked={token === account.token}
                  name="account"
                  onChange={() => setToken(account.token)}
                  type="radio"
                  value={account.token}
                />
                <span className="radio-indicator" aria-hidden="true" />
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <button className="primary-button auth-submit" type="submit">
            Open dispatch
            <Icon name="arrow" />
          </button>
        </form>
        <p className="auth-footnote">
          Demo credentials only. No tenant scope is stored in this browser.
        </p>
      </section>
    </main>
  )
}
