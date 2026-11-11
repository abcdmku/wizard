import { expect } from '@playwright/test'
import { type BrowserPlayer, movePlayers, projectionOf } from './browser-player.js'

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
