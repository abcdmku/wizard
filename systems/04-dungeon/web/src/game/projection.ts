import { INTERACTION_RANGE_TILES, type PlayerProjection } from '@wizard/dungeon-shared'

type Position = PlayerProjection['self']['position']

export const lobbyOverlayActive = (phase: PlayerProjection['phase']): boolean =>
  phase === 'lobby' || phase === 'ready' || phase === 'rematch'

export const playerCanAct = (
  player: Pick<PlayerProjection['self'], 'health' | 'status'>,
): boolean => player.status === 'alive' && player.health > 0

const distanceSquared = (left: Position, right: Position): number => {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

const interactionRadius = (projection: PlayerProjection): number =>
  (projection.map?.tileSize ?? 32) * INTERACTION_RANGE_TILES

export const nearbyFixture = (
  projection: PlayerProjection,
): PlayerProjection['fixtures'][number] | null => {
  const maximum = interactionRadius(projection) ** 2
  return (
    projection.fixtures
      .filter((fixture) => distanceSquared(projection.self.position, fixture.position) <= maximum)
      .sort(
        (left, right) =>
          distanceSquared(projection.self.position, left.position) -
          distanceSquared(projection.self.position, right.position),
      )[0] ?? null
  )
}

export const nearbyLoot = (
  projection: PlayerProjection,
): PlayerProjection['visibleLoot'][number] | null => {
  const maximum = interactionRadius(projection) ** 2
  return (
    projection.visibleLoot
      .filter((loot) => distanceSquared(projection.self.position, loot.position) <= maximum)
      .sort(
        (left, right) =>
          distanceSquared(projection.self.position, left.position) -
          distanceSquared(projection.self.position, right.position),
      )[0] ?? null
  )
}

export const hasBoundKey = (projection: PlayerProjection): boolean =>
  projection.self.inventory.items.some(
    (item) => item.kind === 'player-bound-key' && item.boundToPlayerId === projection.self.id,
  )

export const sharedDoorOpen = (projection: PlayerProjection): boolean =>
  projection.fixtures.some((fixture) => fixture.kind === 'shared-door' && fixture.state === 'open')
