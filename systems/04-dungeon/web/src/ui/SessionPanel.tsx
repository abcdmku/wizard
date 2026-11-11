import { type FormEvent, useState } from 'react'
import type { DungeonSession } from '../network/session'

interface SessionPanelProps {
  onJoin: (session: DungeonSession) => void
}

export const SessionPanel = ({ onJoin }: SessionPanelProps) => {
  const params = new URLSearchParams(window.location.search)
  const [displayName, setDisplayName] = useState(params.get('name') ?? '')
  const [partyId, setPartyId] = useState(
    params.get('party') ?? params.get('partyId') ?? params.get('lobby') ?? 'default',
  )
  const [token, setToken] = useState(params.get('token') ?? params.get('ticket') ?? '')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onJoin({
      join: { partyId: partyId.trim(), displayName: displayName.trim() || 'Delver' },
      token,
    })
  }

  return (
    <main className="entry-shell">
      <section className="entry-card" aria-labelledby="game-title" data-testid="session-panel">
        <p className="eyebrow">Co-op dungeon</p>
        <h1 id="game-title">Lanternfall</h1>
        <p className="entry-copy">
          Bring a signed player ticket. The server will match it to your party slot.
        </p>
        <form onSubmit={submit} className="join-form">
          <label>
            Display name
            <input
              autoComplete="nickname"
              data-testid="display-name"
              maxLength={24}
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            Party
            <input
              data-testid="party-id"
              required
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
            />
          </label>
          <label>
            Player ticket
            <input
              autoComplete="one-time-code"
              data-testid="player-ticket"
              required
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            Enter party
          </button>
        </form>
      </section>
    </main>
  )
}
