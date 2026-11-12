import { expect } from '@playwright/test'
import { ackFor, type BrowserPlayer, projectionOf, sentCommandAfter } from './browser-player.js'

// A player's attack reaches 1.75 tiles and an enemy's reaches 1.15. Striking as soon as the
// enemy is this close leaves it the longest walk before it can hit back.
const attackRangeTiles = 1.7

const enemy = (player: BrowserPlayer, enemyId: string) =>
  player.projection?.enemies.find((candidate) => candidate.id === enemyId)

const distanceToEnemy = (player: BrowserPlayer, enemyId: string): number => {
  const target = enemy(player, enemyId)
  if (target === undefined || target.health === 0) return Number.POSITIVE_INFINITY
  const self = projectionOf(player).self.position
  return Math.hypot(target.position.x - self.x, target.position.y - self.y)
}

const projectedRange = (player: BrowserPlayer, tiles: number): number => {
  const map = projectionOf(player).map
  if (map === null) throw new Error('combat requires a generated dungeon map')
  return map.tileSize * tiles
}

async function awaitEnemyInAttackRange(player: BrowserPlayer, enemyId: string): Promise<void> {
  const attackRange = projectedRange(player, attackRangeTiles)
  await expect
    .poll(
      () => {
        const target = enemy(player, enemyId)
        if (target === undefined || target.health === 0) return 'in-range'
        const projection = projectionOf(player)
        const self = projection.self
        const distance = distanceToEnemy(player, enemyId)
        if (self.health <= 0) {
          return `downed tick=${projection.tick} self=${self.position.x},${self.position.y} enemy=${target.position.x},${target.position.y} distance=${distance}`
        }
        return distance <= attackRange ? 'in-range' : `waiting distance=${distance}`
      },
      // The enemy walks here at its own speed, so this waits on the game and not on the machine.
      { timeout: 15_000, intervals: [50, 100] },
    )
    .toBe('in-range')
  expect(projectionOf(player).self.health).toBeGreaterThan(0)
}

async function useHealthPotionIfNeeded(player: BrowserPlayer): Promise<void> {
  const self = projectionOf(player).self
  const slot = self.inventory.items.findIndex(
    (item) => item.kind === 'consumable' && item.consumableType === 'health-potion',
  )
  if (slot < 0 || self.health >= self.maxHealth) return
  await player.page.getByTestId(`inventory-slot-${slot}`).click()
  await expect.poll(() => projectionOf(player).self.health).toBeGreaterThan(self.health)
  await expect
    .poll(() => projectionOf(player).self.effects.some((effect) => effect.name === 'shield'))
    .toBe(true)
}

/**
 * Strikes with every player each time their attacks are ready, until the enemy is dead.
 * The callers put the players where the fight does not depend on how fast the rounds run:
 * a kill in one round, or a spot the enemy cannot reach.
 */
export async function defeatEnemy(
  players: readonly BrowserPlayer[],
  enemyId: string,
): Promise<void> {
  const leader = players[0]
  if (leader === undefined) throw new Error('combat requires at least one player')
  let nextAttackTick = 0
  for (let round = 0; round < 12; round += 1) {
    await expect
      .poll(() => leader.projection?.tick ?? -1, { timeout: 3_000, intervals: [50, 100] })
      .toBeGreaterThanOrEqual(nextAttackTick)
    await Promise.all(players.map(useHealthPotionIfNeeded))
    const current = enemy(leader, enemyId)
    if (current === undefined || current.health === 0) return
    await Promise.all(players.map((player) => awaitEnemyInAttackRange(player, enemyId)))
    for (const player of players) expect(projectionOf(player).self.health).toBeGreaterThan(0)
    const beforeHealth = current.health
    const commandStarts = players.map((player) => player.sentCommands.length)
    await Promise.all(players.map((player) => player.page.getByTestId('attack-button').click()))
    await Promise.all(
      players.map((player, index) =>
        expect
          .poll(
            () => {
              const start = commandStarts[index]
              if (start === undefined) return 'missing-start'
              const command = sentCommandAfter(
                player,
                start,
                (message) => message.command.type === 'attack',
              )
              if (command === undefined) return 'pending-command'
              const ack = ackFor(player, command.commandId)
              return ack === undefined ? 'pending-ack' : ack.ok ? 'accepted' : ack.code
            },
            { timeout: 3_000, intervals: [50, 100] },
          )
          .toBe('accepted'),
      ),
    )
    const committedSequences = players.flatMap((player, index) => {
      const start = commandStarts[index]
      if (start === undefined) return []
      const command = sentCommandAfter(
        player,
        start,
        (message) => message.command.type === 'attack',
      )
      if (command === undefined) return []
      const ack = ackFor(player, command.commandId)
      return ack === undefined || !ack.ok ? [] : [ack.sequence]
    })
    expect(committedSequences).toHaveLength(players.length)
    const committedSequence = Math.max(...committedSequences)
    await expect
      .poll(() => leader.latestSnapshot?.sequence ?? -1, {
        timeout: 3_000,
        intervals: [50, 100],
      })
      .toBeGreaterThanOrEqual(committedSequence)
    expect(enemy(leader, enemyId)?.health ?? 0).toBeLessThan(beforeHealth)
    if (enemy(leader, enemyId)?.health === 0) return
    nextAttackTick = projectionOf(leader).tick + 5
  }
  expect(enemy(leader, enemyId)?.health).toBe(0)
}
