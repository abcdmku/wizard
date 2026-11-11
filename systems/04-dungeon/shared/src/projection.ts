import { z } from 'zod'
import {
  DungeonMapSchema,
  DungeonPhaseSchema,
  EntityIdSchema,
  LootIdSchema,
  PartyIdSchema,
  SequenceSchema,
  TickSchema,
  WorldPositionSchema,
} from './domain.js'
import {
  type DungeonState,
  DungeonStateSchema,
  EnemySchema,
  PlayerStateSchema,
  ProjectileSchema,
  PublicPlayerStateBaseSchema,
  PublicSharedDoorSchema,
  SharedObjectiveSchema,
  WorldFixtureSchema,
} from './entities.js'
import type { Viewer } from './protocol.js'

export const OwnPlayerProjectionSchema = PlayerStateSchema

export const TeammateProjectionSchema = PublicPlayerStateBaseSchema.extend({
  publicItemCount: z.number().int().nonnegative(),
}).strict()

export const VisibleLootSchema = z
  .object({
    kind: z.literal('loot'),
    id: LootIdSchema,
    position: WorldPositionSchema,
    itemId: EntityIdSchema,
    itemKind: z.enum(['player-bound-key', 'consumable']),
  })
  .strict()

export const PublicDoorProjectionSchema = PublicSharedDoorSchema

export const PublicFixtureProjectionSchema = z.discriminatedUnion('kind', [
  PublicDoorProjectionSchema,
  WorldFixtureSchema,
])

export const PlayerProjectionSchema = z
  .object({
    partyId: PartyIdSchema,
    sequence: SequenceSchema,
    tick: TickSchema,
    phase: DungeonPhaseSchema,
    map: DungeonMapSchema.nullable(),
    self: OwnPlayerProjectionSchema,
    teammates: z.array(TeammateProjectionSchema).max(3),
    enemies: z.array(EnemySchema),
    visibleLoot: z.array(VisibleLootSchema),
    fixtures: z.array(PublicFixtureProjectionSchema),
    projectiles: z.array(ProjectileSchema),
    objective: SharedObjectiveSchema,
  })
  .strict()

const projectionValue = (state: DungeonState, viewer: Viewer): PlayerProjection | undefined => {
  if (state.context.partyId !== viewer.partyId) return undefined
  const self = state.players.find((player) => player.id === viewer.playerId)
  if (self === undefined) return undefined

  return {
    partyId: state.context.partyId,
    sequence: state.sequence,
    tick: state.tick,
    phase: state.phase,
    map: state.map,
    self,
    teammates: state.players
      .filter((player) => player.id !== self.id)
      .map(({ inventory, effects, ...publicPlayer }) => ({
        ...publicPlayer,
        publicItemCount: inventory.items.length,
      })),
    enemies: state.enemies,
    visibleLoot: state.loot.map(({ item, ...loot }) => ({
      ...loot,
      itemId: item.id,
      itemKind: item.kind,
    })),
    fixtures: state.fixtures.map((fixture) => {
      if (fixture.kind === 'fixture') return fixture
      const { requiredKeyId, ...publicDoor } = fixture
      return publicDoor
    }),
    projectiles: state.projectiles,
    objective: state.objective,
  }
}

const cloneProjection = (projection: PlayerProjection): PlayerProjection => ({
  ...projection,
  map:
    projection.map === null
      ? null
      : {
          ...projection.map,
          rows: [...projection.map.rows],
          spawnPoints: projection.map.spawnPoints.map((point) => ({ ...point })),
        },
  self: {
    ...projection.self,
    position: { ...projection.self.position },
    inventory: {
      items: projection.self.inventory.items.map((item) => ({ ...item })),
    },
    effects: projection.self.effects.map((effect) => ({ ...effect })),
  },
  teammates: projection.teammates.map((player) => ({
    ...player,
    position: { ...player.position },
  })),
  enemies: projection.enemies.map((enemy) => ({
    ...enemy,
    position: { ...enemy.position },
  })),
  visibleLoot: projection.visibleLoot.map((loot) => ({
    ...loot,
    position: { ...loot.position },
  })),
  fixtures: projection.fixtures.map((fixture) => ({
    ...fixture,
    position: { ...fixture.position },
  })),
  projectiles: projection.projectiles.map((projectile) => ({
    ...projectile,
    position: { ...projectile.position },
  })),
  objective: { ...projection.objective },
})

export function projectDungeonForViewer(
  state: DungeonState,
  viewer: Viewer,
): PlayerProjection | undefined {
  const projection = projectionValue(state, viewer)
  return projection === undefined ? undefined : PlayerProjectionSchema.parse(projection)
}

const parsedStateToken = Symbol('ParsedDungeonState')

export class ParsedDungeonState {
  readonly #state: DungeonState

  private constructor(token: symbol, state: DungeonState) {
    if (token !== parsedStateToken)
      throw new TypeError('ParsedDungeonState requires schema parsing')
    this.#state = state
  }

  static parse(input: unknown): ParsedDungeonState {
    return new ParsedDungeonState(parsedStateToken, DungeonStateSchema.parse(input))
  }

  project(viewer: Viewer): PlayerProjection | undefined {
    const projection = projectionValue(this.#state, viewer)
    return projection === undefined ? undefined : cloneProjection(projection)
  }
}

const projectParsedState = ParsedDungeonState.prototype.project

export function projectParsedDungeonForViewer(
  state: ParsedDungeonState,
  viewer: Viewer,
): PlayerProjection | undefined {
  if (!(state instanceof ParsedDungeonState)) {
    throw new TypeError('projectParsedDungeonForViewer requires ParsedDungeonState')
  }
  return projectParsedState.call(state, viewer)
}

export type OwnPlayerProjection = z.infer<typeof OwnPlayerProjectionSchema>
export type TeammateProjection = z.infer<typeof TeammateProjectionSchema>
export type VisibleLoot = z.infer<typeof VisibleLootSchema>
export type PublicDoorProjection = z.infer<typeof PublicDoorProjectionSchema>
export type PublicFixtureProjection = z.infer<typeof PublicFixtureProjectionSchema>
export type PlayerProjection = z.infer<typeof PlayerProjectionSchema>
