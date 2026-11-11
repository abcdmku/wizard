import type { PlayerProjection } from '@wizard/dungeon-shared'

interface LobbyPanelProps {
  projection: PlayerProjection
  connected: boolean
  onReady: (ready: boolean) => void
}

export const LobbyPanel = ({ projection, connected, onReady }: LobbyPanelProps) => {
  const players = [projection.self, ...projection.teammates]
  return (
    <section className="lobby-panel panel" data-testid="lobby-panel" aria-labelledby="lobby-title">
      <p className="eyebrow">Party camp</p>
      <h1 id="lobby-title">The gate opens when everyone is ready.</h1>
      <ul className="lobby-roster" aria-label="Party members">
        {players.map((player, index) => (
          <li key={player.id} data-testid={`lobby-player-${index}`}>
            <span className="avatar-mark" aria-hidden="true">
              {player.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              {player.displayName}
              {player.id === projection.self.id ? ' (you)' : ''}
            </span>
            <span className={`ready-state ${player.ready ? 'is-ready' : ''}`}>
              {player.ready
                ? 'Ready'
                : player.presence === 'connected'
                  ? 'Waiting'
                  : 'Reconnecting'}
            </span>
          </li>
        ))}
      </ul>
      <button
        className={projection.self.ready ? 'secondary-button' : 'primary-button'}
        data-testid="ready-button"
        disabled={!connected}
        onClick={() => onReady(!projection.self.ready)}
        type="button"
      >
        {projection.self.ready ? 'Not ready' : 'Ready up'}
      </button>
      <p className="keyboard-note">
        Move with WASD or arrow keys. Space attacks. E interacts. F picks up loot.
      </p>
    </section>
  )
}
