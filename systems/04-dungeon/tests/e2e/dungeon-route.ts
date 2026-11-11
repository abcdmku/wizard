import { expect } from '@playwright/test'
import { type BrowserPlayer, moveAxis, movePlayers, projectionOf } from './browser-player.js'

const tileSize = (player: BrowserPlayer): number => {
  const map = projectionOf(player).map
  if (map === null) throw new Error('the route needs a generated dungeon map')
  return map.tileSize
}

/**
 * Walks the key owner north from the opened boss gate to the rows where the pillar beside
 * the gate keeps the boss off anyone standing further west.
 */
export const leaveBossGate = async (player: BrowserPlayer): Promise<void> => {
  const tile = tileSize(player)
  await moveAxis(player, 'y', 7.12 * tile, 0.22 * tile)
}

/**
 * Moves a fighter to the spot the boss cannot reach: west of the pillar that stands above
 * the boss gate, leaning on it.
 *
 * The boss walks straight at the nearest player and does not go around walls, so that
 * pillar stops it about one and a half tiles from fighters standing here. That is inside
 * their reach of 1.75 tiles and outside its own of 1.15, however long the fight takes.
 * Leaning on the pillar fixes the column, and either row inside the tolerance works. On the
 * way, the pillar beside the gate holds the boss in the same manner once a fighter has
 * reached the first column, so only the walk up to that point is a race, and a fighter
 * moves twice as fast as the boss.
 * tests/unit/boss-cover.test.ts replays this route against the simulation.
 */
export const takeBossCover = async (player: BrowserPlayer): Promise<void> => {
  const tile = tileSize(player)
  await moveAxis(player, 'x', 16.1 * tile, 0.45 * tile)
  await moveAxis(player, 'y', 3.05 * tile, 0.125 * tile)
  await moveAxis(player, 'x', 16.64 * tile, 0.1 * tile)
}

export const moveToDoorRow = async (
  players: readonly BrowserPlayer[],
  doorY: number,
): Promise<void> => {
  await movePlayers(players, 'y', doorY, 6)
  for (const player of players) {
    expect(Math.abs(projectionOf(player).self.position.y - doorY)).toBeLessThanOrEqual(6)
  }
}

export const routeToDoorRow = async (
  players: readonly BrowserPlayer[],
  doorY: number,
): Promise<void> => {
  const eastSide = players.filter((player) => projectionOf(player).self.position.x > 336)
  const westSide = players.filter((player) => projectionOf(player).self.position.x <= 336)
  if (eastSide.length > 0) {
    await movePlayers(eastSide, 'x', 430, 20)
    await moveToDoorRow(eastSide, doorY)
    await movePlayers(eastSide, 'x', 144, 12)
  }
  if (westSide.length > 0) {
    await movePlayers(westSide, 'x', 144, 12)
    await moveToDoorRow(westSide, doorY)
  }
}
