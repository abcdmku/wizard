import { PlayerProjectionSchema } from '@wizard/dungeon-shared'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlayerControls } from '../game/usePlayerControls'
import { Hud } from './Hud'

const downedProjection = PlayerProjectionSchema.parse({
  partyId: 'party-1',
  sequence: 4,
  tick: 4,
  phase: 'exploration',
  map: null,
  self: {
    kind: 'player',
    id: 'player-1',
    displayName: 'Mira',
    position: { x: 32, y: 32 },
    facing: 'east',
    health: 0,
    maxHealth: 10,
    ready: true,
    rematchVote: false,
    presence: 'connected',
    status: 'downed',
    inventory: {
      items: [
        {
          kind: 'consumable',
          id: 'potion-1',
          consumableType: 'health-potion',
          charges: 1,
        },
      ],
    },
    effects: [],
  },
  teammates: [],
  enemies: [],
  visibleLoot: [
    {
      kind: 'loot',
      id: 'loot-1',
      position: { x: 32, y: 32 },
      itemId: 'loot-item-1',
      itemKind: 'consumable',
    },
  ],
  fixtures: [
    {
      kind: 'fixture',
      id: 'exit-1',
      fixtureType: 'exit',
      position: { x: 32, y: 32 },
      state: 'active',
    },
  ],
  projectiles: [],
  objective: {
    id: 'objective-1',
    kind: 'escape',
    label: 'Leave the dungeon',
    progress: 0,
    target: 1,
    completed: false,
  },
})

const disabledControls: PlayerControls = {
  enabled: false,
  queueAction: () => {},
  startDirection: () => {},
  stopDirection: () => {},
}

describe('downed HUD', () => {
  it('announces the state and disables every actionable control', () => {
    const markup = renderToStaticMarkup(
      createElement(Hud, { projection: downedProjection, controls: disabledControls }),
    )
    expect(markup).toContain('Downed. Waiting for your party.')
    for (const testId of [
      'inventory-slot-0',
      'attack-button',
      'interact-button',
      'pickup-button',
    ]) {
      expect(markup).toMatch(new RegExp(`data-testid="${testId}"[^>]*disabled=""`))
    }
    expect(markup).toMatch(/aria-label="Move up"[^>]*disabled=""/)
  })
})
