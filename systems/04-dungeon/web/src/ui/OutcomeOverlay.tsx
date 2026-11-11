import type { PlayerProjection } from '@wizard/dungeon-shared'

interface OutcomeOverlayProps {
  projection: PlayerProjection
  connected: boolean
  onRematch: () => void
}

export const OutcomeOverlay = ({ projection, connected, onRematch }: OutcomeOverlayProps) => {
  if (projection.phase !== 'victory' && projection.phase !== 'defeat') return null
  const players = [projection.self, ...projection.teammates]
  const voteCount = players.filter((player) => player.rematchVote).length
  return (
    <section
      aria-labelledby="outcome-title"
      aria-modal="true"
      className={`outcome-overlay ${projection.phase}`}
      data-testid="outcome-dialog"
      role="dialog"
    >
      <p className="eyebrow">Run complete</p>
      <h1 id="outcome-title">{projection.phase === 'victory' ? 'Victory' : 'Defeat'}</h1>
      <p>
        {projection.phase === 'victory'
          ? 'The dungeon is quiet. For now.'
          : 'The party fell, but the next map is waiting.'}
      </p>
      <button
        className="primary-button"
        data-testid="rematch-button"
        disabled={!connected || projection.self.rematchVote}
        onClick={onRematch}
        type="button"
      >
        {projection.self.rematchVote ? 'Rematch vote sent' : 'Vote for rematch'}
      </button>
      <p className="quiet" aria-live="polite">
        {voteCount} of {players.length} voted
      </p>
    </section>
  )
}
