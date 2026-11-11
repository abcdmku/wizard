import { expect, test } from '@playwright/test'
import { restartApi, seedParty } from '../helpers/integration.js'
import {
  ackFor,
  type BrowserPlayer,
  createBrowserPlayer,
  moveAxis,
  movePlayers,
  moveUntilVisible,
  openPlayerPage,
  projectionOf,
  sentCommandAfter,
} from './browser-player.js'
import { defeatEnemy } from './combat.js'
import { moveToDoorRow, routeToDoorRow } from './dungeon-route.js'

const requestedPlayers = Number(process.env.DUNGEON_E2E_PLAYERS ?? '2')
if (!Number.isInteger(requestedPlayers) || requestedPlayers < 2 || requestedPlayers > 4) {
  throw new Error('DUNGEON_E2E_PLAYERS must be an integer from 2 through 4')
}
const capturePublicEvidence = requestedPlayers === 2

test('2-4 players clear the dungeon with an owner-bound key and vote for a rematch', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const partyId = `e2e-${Date.now()}`
  const roster = Array.from({ length: requestedPlayers }, (_, index) => ({
    id: `e2e-player-${index}`,
    name: `Delver ${index + 1}`,
  }))
  await seedParty(partyId, roster, 1)

  const players: BrowserPlayer[] = []
  try {
    for (const member of roster) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const player = createBrowserPlayer(member, context, page)
      players.push(player)
      await openPlayerPage(player, partyId)
    }
    const owner = players[0]
    const teammate = players[1]
    if (owner === undefined || teammate === undefined)
      throw new Error('journey requires two players')

    if (capturePublicEvidence) {
      await owner.page.screenshot({
        path: 'docs/assets/dungeon-lobby.png',
        fullPage: true,
        animations: 'disabled',
      })
    }

    await Promise.all(players.map((player) => player.page.getByTestId('ready-button').click()))
    await Promise.all(
      players.map((player) => expect.poll(() => player.projection?.phase).toBe('exploration')),
    )
    await expect(owner.page.getByTestId('dungeon-canvas')).toBeVisible()
    const fighters = [owner, teammate]
    await movePlayers(fighters, 'x', 144, 12)
    await movePlayers(fighters, 'y', 145, 24)
    await defeatEnemy(fighters, 'enemy:crawler:1')

    const boundKeyLoot = projectionOf(owner).visibleLoot.find(
      (loot) => loot.itemKind === 'player-bound-key',
    )
    if (boundKeyLoot === undefined) throw new Error('generated dungeon has no bound key')
    const ownerBeforeDeniedPickup = projectionOf(owner).self
    await moveUntilVisible(teammate, 'east', 'pickup-button')
    const teammateCommandStart = teammate.sentCommands.length
    await teammate.page.getByTestId('pickup-button').click()
    await expect
      .poll(
        () =>
          sentCommandAfter(
            teammate,
            teammateCommandStart,
            (message) =>
              message.command.type === 'pickup' && message.command.lootId === boundKeyLoot.id,
          )?.commandId ?? null,
      )
      .not.toBeNull()
    const deniedCommand = sentCommandAfter(
      teammate,
      teammateCommandStart,
      (message) => message.command.type === 'pickup' && message.command.lootId === boundKeyLoot.id,
    )
    if (deniedCommand === undefined) throw new Error('teammate pickup command was not sent')
    await expect
      .poll(() => {
        const ack = ackFor(teammate, deniedCommand.commandId)
        return ack === undefined ? 'pending' : ack.ok ? 'accepted' : ack.code
      })
      .toBe('key-not-owned')
    const deniedAck = ackFor(teammate, deniedCommand.commandId)
    if (deniedAck === undefined || deniedAck.ok) throw new Error('teammate pickup was not denied')
    await Promise.all(
      [owner, teammate].map((player) =>
        expect
          .poll(() => player.latestSnapshot?.sequence ?? -1)
          .toBeGreaterThanOrEqual(deniedAck.sequence),
      ),
    )
    expect(projectionOf(owner).self).toEqual(ownerBeforeDeniedPickup)
    expect(projectionOf(owner).visibleLoot.find((loot) => loot.id === boundKeyLoot.id)).toEqual(
      boundKeyLoot,
    )

    await moveUntilVisible(owner, 'east', 'pickup-button')
    const ownerCommandStart = owner.sentCommands.length
    await owner.page.getByTestId('pickup-button').click()
    await expect
      .poll(() => {
        const command = sentCommandAfter(
          owner,
          ownerCommandStart,
          (message) =>
            message.command.type === 'pickup' && message.command.lootId === boundKeyLoot.id,
        )
        if (command === undefined) return 'pending'
        const ack = ackFor(owner, command.commandId)
        return ack === undefined ? 'pending' : ack.ok ? 'accepted' : ack.code
      })
      .toBe('accepted')
    await expect(owner.page.getByTestId('inventory-slot-0')).toContainText('Bound key (yours)')
    const privateKey = projectionOf(owner).self.inventory.items.find(
      (item) => item.kind === 'player-bound-key',
    )
    if (privateKey === undefined) throw new Error('owner pickup did not yield the bound key')
    expect(privateKey.boundToPlayerId).toBe(owner.id)
    await expect(teammate.page.getByText('Bound key (yours)')).toHaveCount(0)
    await expect(teammate.page.getByTestId(`teammate-${owner.id}`)).toContainText('1 items')
    if (capturePublicEvidence) {
      await owner.page.screenshot({
        path: 'docs/assets/dungeon-bound-key.png',
        fullPage: true,
        animations: 'disabled',
      })
    }

    const sharedDoor = projectionOf(owner).fixtures.find(
      (fixture) => fixture.kind === 'shared-door',
    )
    if (sharedDoor === undefined) throw new Error('generated dungeon has no shared door')
    await routeToDoorRow([owner], sharedDoor.position.y)
    await moveAxis(owner, 'x', sharedDoor.position.x - 30, 4)
    await expect(owner.page.getByTestId('interact-button')).toBeVisible()
    await expect(owner.page.getByTestId('interact-button')).toContainText('Unlock shared door')
    await owner.page.getByTestId('interact-button').click()
    await Promise.all(
      players.map((player) =>
        expect(player.page.getByTestId('shared-door-state')).toHaveText('Shared door: open'),
      ),
    )

    const reconnectBaselines = players.map((player) => ({
      player,
      websocketGeneration: player.websocketGeneration,
      fullSnapshotCount: player.fullSnapshotCount,
    }))
    await restartApi()
    await Promise.all(
      reconnectBaselines.map(({ player, websocketGeneration }) =>
        expect
          .poll(() => player.websocketGeneration, { timeout: 30_000 })
          .toBeGreaterThan(websocketGeneration),
      ),
    )
    await Promise.all(
      reconnectBaselines.map(({ player, fullSnapshotCount }) =>
        expect
          .poll(() => player.fullSnapshotCount, { timeout: 30_000 })
          .toBeGreaterThan(fullSnapshotCount),
      ),
    )
    await Promise.all(
      reconnectBaselines.map(({ player, websocketGeneration }) =>
        expect
          .poll(() => player.latestSnapshotGeneration, { timeout: 30_000 })
          .toBeGreaterThan(websocketGeneration),
      ),
    )
    await Promise.all(
      players.map((player) =>
        expect(player.page.getByTestId('connection-status')).toHaveText('Connected'),
      ),
    )

    const restoredOwner = projectionOf(owner)
    const restoredTeammate = projectionOf(teammate)
    const ownerDoor = restoredOwner.fixtures.find((fixture) => fixture.kind === 'shared-door')
    const teammateDoor = restoredTeammate.fixtures.find((fixture) => fixture.kind === 'shared-door')
    expect(ownerDoor).toMatchObject({ state: 'open', openedByPlayerId: owner.id })
    expect(teammateDoor).toMatchObject({ state: 'open', openedByPlayerId: owner.id })
    expect(restoredOwner.self.inventory.items).toEqual([])
    const publicOwner = restoredTeammate.teammates.find((player) => player.id === owner.id)
    if (publicOwner === undefined) throw new Error('owner missing from teammate projection')
    expect(publicOwner.publicItemCount).toBe(0)
    expect(publicOwner).not.toHaveProperty('inventory')
    expect(publicOwner).not.toHaveProperty('effects')
    expect(JSON.stringify(publicOwner)).not.toContain(privateKey.id)
    expect(JSON.stringify(publicOwner)).not.toContain('boundToPlayerId')
    expect(JSON.stringify(teammate.latestSnapshot)).not.toContain(privateKey.id)
    await expect(owner.page.getByTestId('shared-door-state')).toHaveText('Shared door: open')
    if (capturePublicEvidence) {
      await owner.page.screenshot({
        path: 'docs/assets/dungeon-reconnect.png',
        fullPage: true,
        animations: 'disabled',
      })
    }

    await routeToDoorRow(fighters, sharedDoor.position.y)
    await movePlayers(fighters, 'x', 430, 20)
    await movePlayers(fighters, 'y', 145, 24)
    await defeatEnemy(fighters, 'enemy:warden:1', [{ axis: 'x', target: 430 }])
    await moveUntilVisible(owner, 'south', 'pickup-button')
    await owner.page.getByTestId('pickup-button').click()
    await expect.poll(() => owner.projection?.objective.progress).toBe(1)

    const healthPotion = projectionOf(owner).visibleLoot.find((loot) => loot.id.includes('potion'))
    if (healthPotion === undefined) throw new Error('generated dungeon has no health potion')
    await routeToDoorRow([owner], sharedDoor.position.y)
    await moveAxis(owner, 'x', healthPotion.position.x, 8)
    await moveUntilVisible(owner, 'south', 'pickup-button')
    await owner.page.getByTestId('pickup-button').click()
    await expect
      .poll(() =>
        projectionOf(owner).self.inventory.items.findIndex(
          (item) => item.kind === 'consumable' && item.consumableType === 'health-potion',
        ),
      )
      .toBeGreaterThanOrEqual(0)

    await routeToDoorRow([owner], sharedDoor.position.y)
    await moveAxis(owner, 'x', 430, 20)
    await moveToDoorRow(fighters, sharedDoor.position.y)
    await movePlayers(fighters, 'x', 560, 8)
    await moveUntilVisible(owner, 'south', 'interact-button')
    const bossFormation = projectionOf(owner).self.position
    await moveAxis(teammate, 'y', bossFormation.y, 8)
    await moveAxis(teammate, 'x', bossFormation.x, 8)
    await expect
      .poll(() => {
        const ownerPosition = projectionOf(owner).self.position
        const teammatePosition = projectionOf(teammate).self.position
        return Math.hypot(
          teammatePosition.x - ownerPosition.x,
          teammatePosition.y - ownerPosition.y,
        )
      })
      .toBeLessThanOrEqual(12)
    await owner.page.getByTestId('interact-button').click()
    await Promise.all(
      fighters.map((player) => expect.poll(() => player.projection?.phase).toBe('boss')),
    )
    await expect(owner.page.getByTestId('boss-health')).toBeVisible()

    await defeatEnemy(fighters, 'enemy:boss', [
      { axis: 'y', target: 277 },
      { axis: 'y', target: 277 },
      { axis: 'y', target: 277 },
    ])
    await Promise.all(
      players.map((player) =>
        expect(player.page.getByTestId('outcome-dialog')).toContainText('Victory'),
      ),
    )

    await Promise.all(players.map((player) => player.page.getByTestId('rematch-button').click()))
    await Promise.all(
      players.map((player) => expect(player.page.getByTestId('lobby-panel')).toBeVisible()),
    )
  } finally {
    await Promise.all(players.map((player) => player.context.close()))
  }
})
