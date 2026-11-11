import type { InventoryItem, PlayerProjection } from '@wizard/dungeon-shared'
import type { PointerEvent } from 'react'
import { hasBoundKey, nearbyFixture, nearbyLoot, sharedDoorOpen } from '../game/projection'
import type { PlayerControls } from '../game/usePlayerControls'

interface HudProps {
  projection: PlayerProjection
  controls: PlayerControls
}

const itemName = (item: InventoryItem): string => {
  if (item.kind === 'player-bound-key') return 'Bound key (yours)'
  switch (item.consumableType) {
    case 'health-potion':
      return 'Health potion'
    case 'shield-tonic':
      return 'Shield tonic'
    case 'haste-tonic':
      return 'Haste tonic'
  }
}

const DirectionButton = ({
  label,
  direction,
  controls,
}: {
  label: string
  direction: 'up' | 'down' | 'left' | 'right'
  controls: PlayerControls
}) => {
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    controls.startDirection(direction)
  }
  const stop = () => controls.stopDirection(direction)
  return (
    <button
      aria-label={`Move ${direction}`}
      className={`direction-button move-${direction}`}
      disabled={!controls.enabled}
      onPointerCancel={stop}
      onPointerDown={start}
      onPointerUp={stop}
      type="button"
    >
      {label}
    </button>
  )
}

export const Hud = ({ projection, controls }: HudProps) => {
  const interaction = nearbyFixture(projection)
  const pickup = nearbyLoot(projection)
  const boss = projection.enemies.find((enemy) => enemy.rank === 'boss')
  const downed = projection.self.status === 'downed' || projection.self.health === 0
  const doorUnlocked = sharedDoorOpen(projection)
  const canUnlock =
    interaction?.kind === 'shared-door' && interaction.state === 'locked' && hasBoundKey(projection)
  const interactionLabel = canUnlock
    ? 'Unlock shared door'
    : interaction?.kind === 'shared-door'
      ? interaction.state === 'open'
        ? 'Shared door is open'
        : 'Shared door is locked'
      : interaction?.fixtureType === 'exit'
        ? 'Leave dungeon'
        : 'Interact'

  return (
    <div className="hud" data-testid="hud">
      <header className="mission-strip">
        <span className="phase-label" data-testid="phase-label">
          {projection.phase}
        </span>
        <span>
          {projection.objective.label} {projection.objective.progress}/{projection.objective.target}
        </span>
        <span data-testid="shared-door-state">Shared door: {doorUnlocked ? 'open' : 'closed'}</span>
      </header>

      <section className="self-card panel" aria-label="Your status">
        <div className="status-heading">
          <strong>{projection.self.displayName}</strong>
          <span>
            {projection.self.health}/{projection.self.maxHealth} HP
          </span>
        </div>
        <progress
          aria-label="Your health"
          max={projection.self.maxHealth}
          value={projection.self.health}
        />
        {downed ? (
          <p className="downed-state" role="status">
            Downed. Waiting for your party.
          </p>
        ) : null}
        {projection.self.effects.length > 0 ? (
          <ul className="effect-list" aria-label="Your active effects">
            {projection.self.effects.map((effect) => (
              <li key={effect.id}>
                {effect.name} {Math.ceil(effect.remainingTicks / 10)}s ×{effect.stacks}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="team-card panel" aria-label="Teammates">
        <h2>Party</h2>
        {projection.teammates.length === 0 ? <p className="quiet">No teammates yet</p> : null}
        <ul>
          {projection.teammates.map((player) => (
            <li key={player.id} data-testid={`teammate-${player.id}`}>
              <span>{player.displayName}</span>
              <progress
                aria-label={`${player.displayName} health`}
                max={player.maxHealth}
                value={player.health}
              />
              <span>
                {player.health}/{player.maxHealth} HP
              </span>
              <span>{player.publicItemCount} items</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inventory panel" aria-label="Your private inventory">
        <h2>Inventory</h2>
        <ol>
          {[0, 1, 2, 3].map((slot) => {
            const item = projection.self.inventory.items[slot]
            const quantity = item?.kind === 'consumable' ? item.charges : item === undefined ? 0 : 1
            return (
              <li key={slot}>
                <button
                  data-testid={`inventory-slot-${slot}`}
                  disabled={
                    !controls.enabled || item === undefined || item.kind === 'player-bound-key'
                  }
                  onClick={() => controls.queueAction({ type: 'item-use', slot })}
                  title={item === undefined ? 'Empty slot' : itemName(item)}
                  type="button"
                >
                  <kbd>{slot + 1}</kbd>
                  <span>{item === undefined ? 'Empty' : itemName(item)}</span>
                  {item !== undefined ? <small>×{quantity}</small> : null}
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      {boss !== undefined ? (
        <section className="boss-bar" data-testid="boss-health" aria-label="Boss health">
          <strong>Dungeon Heart</strong>
          <progress max={boss.maxHealth} value={boss.health} />
          <span>
            {boss.health}/{boss.maxHealth}
          </span>
        </section>
      ) : null}

      <div className="action-tray">
        <button
          className="action-button attack"
          data-testid="attack-button"
          disabled={!controls.enabled}
          onClick={() => controls.queueAction({ type: 'attack' })}
          type="button"
        >
          Attack <kbd>Space</kbd>
        </button>
        {interaction !== null ? (
          <button
            className="action-button"
            data-testid="interact-button"
            disabled={!controls.enabled || (interaction.kind === 'shared-door' && !canUnlock)}
            onClick={() => controls.queueAction({ type: 'interact', targetId: interaction.id })}
            type="button"
          >
            {interactionLabel} <kbd>E</kbd>
          </button>
        ) : null}
        {pickup !== null ? (
          <button
            className="action-button"
            data-testid="pickup-button"
            disabled={!controls.enabled}
            onClick={() => controls.queueAction({ type: 'pickup', lootId: pickup.id })}
            type="button"
          >
            Pick up <kbd>F</kbd>
          </button>
        ) : null}
      </div>

      <nav className="touch-pad" aria-label="Touch movement controls">
        <DirectionButton label="↑" direction="up" controls={controls} />
        <DirectionButton label="←" direction="left" controls={controls} />
        <DirectionButton label="↓" direction="down" controls={controls} />
        <DirectionButton label="→" direction="right" controls={controls} />
      </nav>
    </div>
  )
}
