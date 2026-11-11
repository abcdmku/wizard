import { JoinDungeonInputSchema } from '@wizard/dungeon-shared'
import { useCallback, useState } from 'react'
import { DungeonCanvas } from './game/DungeonCanvas'
import { lobbyOverlayActive, nearbyFixture, nearbyLoot, playerCanAct } from './game/projection'
import { usePlayerControls } from './game/usePlayerControls'
import {
  clearSession,
  type DungeonSession,
  readInitialSession,
  removeTicketFromAddress,
  saveSession,
} from './network/session'
import { useDungeonSocket } from './network/useDungeonSocket'
import { ConnectionBanner } from './ui/ConnectionBanner'
import { Hud } from './ui/Hud'
import { LobbyPanel } from './ui/LobbyPanel'
import { OutcomeOverlay } from './ui/OutcomeOverlay'
import { SessionPanel } from './ui/SessionPanel'

const activePhase = (phase: string): boolean => phase === 'exploration' || phase === 'boss'

export const App = () => {
  const [session, setSession] = useState<DungeonSession | null>(readInitialSession)
  const socket = useDungeonSocket(session)
  const projection = socket.projection
  const fixture = projection === null ? null : nearbyFixture(projection)
  const loot = projection === null ? null : nearbyLoot(projection)
  const enabled =
    projection !== null &&
    socket.status === 'connected' &&
    activePhase(projection.phase) &&
    playerCanAct(projection.self)
  const controls = usePlayerControls(enabled, fixture?.id ?? null, loot?.id ?? null, socket.send)

  const join = useCallback((candidate: DungeonSession) => {
    const parsed = JoinDungeonInputSchema.safeParse(candidate.join)
    const token = candidate.token.trim()
    if (!parsed.success || token.length === 0) return
    const next = { join: parsed.data, token }
    saveSession(next)
    removeTicketFromAddress()
    setSession(next)
  }, [])

  const leave = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  if (session === null) return <SessionPanel onJoin={join} />

  if (projection === null) {
    return (
      <main className="game-shell loading-shell">
        <div className="dungeon-loading" role="status">
          <span className="loading-rune" aria-hidden="true">
            L
          </span>
          <p>Finding your party...</p>
        </div>
        <ConnectionBanner
          state={socket.status}
          retryInMs={socket.retryInMs}
          message={socket.message}
          onLeave={leave}
          onRetry={socket.retryNow}
        />
      </main>
    )
  }

  const showLobby = lobbyOverlayActive(projection.phase)
  return (
    <main className="game-shell">
      {showLobby ? null : <DungeonCanvas epoch={socket.epoch ?? 0} projection={projection} />}
      {showLobby ? (
        <LobbyPanel
          connected={socket.status === 'connected' && projection.phase === 'lobby'}
          onReady={(ready) => socket.send({ type: 'ready', ready })}
          projection={projection}
        />
      ) : (
        <Hud controls={controls} projection={projection} />
      )}
      {projection.phase === 'generated' ? (
        <div className="phase-curtain panel" role="status">
          Mapping the dungeon...
        </div>
      ) : null}
      <OutcomeOverlay
        connected={socket.status === 'connected'}
        onRematch={() => socket.send({ type: 'rematch' })}
        projection={projection}
      />
      {socket.status === 'connected' && socket.message !== null ? (
        <aside className="server-notice" role="status">
          {socket.message}
        </aside>
      ) : null}
      <ConnectionBanner
        state={socket.status}
        retryInMs={socket.retryInMs}
        message={socket.message}
        onLeave={leave}
        onRetry={socket.retryNow}
      />
    </main>
  )
}
