import { boundary, defineWizard, type SnapshotMigration } from '@openwizard/core'
import type { DomainResult, PlayerCommand, WorldState } from './domain.js'
import { simulateTick } from './engine.js'
import { applyAdminReset, applyAuthenticatedPlayerCommand, applyPresence } from './server.js'

export interface DungeonWizardContext {
  readonly world: WorldState
  readonly lastCommandReceipt?: RecentCommandReceipt
  readonly commandResults?: Readonly<Record<string, DomainResult>>
  readonly commandOrder?: readonly string[]
}

export interface RecentCommandReceipt {
  readonly key: string
  readonly digest: string
  readonly result: DomainResult
}

export interface PlayerCommandEvent {
  readonly commandId: string
  readonly digest: string
  readonly playerId: string
  readonly command: PlayerCommand
}

export interface PresenceEvent {
  readonly playerId: string
}

export interface ResetEvent {
  readonly seed: number
}

type PhaseResult = { readonly keep: true } | { readonly done: WorldState['phase'] }

export interface DungeonEventArgs<P> {
  readonly context: DungeonWizardContext
  readonly payload: P
  readonly update: (patch: Partial<DungeonWizardContext>) => void
}

const updateWorld = (
  context: DungeonWizardContext,
  nextWorld: WorldState,
  update: DungeonEventArgs<unknown>['update'],
  patch: Partial<DungeonWizardContext> = {},
): PhaseResult => {
  update(contextPatch(context, nextWorld, patch))
  return nextWorld.phase === context.world.phase ? { keep: true } : { done: nextWorld.phase }
}

const contextPatch = (
  context: DungeonWizardContext,
  nextWorld: WorldState,
  patch: Partial<DungeonWizardContext> = {},
): Partial<DungeonWizardContext> => ({
  ...patch,
  world: nextWorld,
  ...(context.commandResults === undefined ? {} : { commandResults: {} }),
  ...(context.commandOrder === undefined ? {} : { commandOrder: [] }),
})

const handlers = {
  'world.tick': ({ context, update }: DungeonEventArgs<Record<string, never>>): PhaseResult =>
    updateWorld(context, simulateTick(context.world), update),
  'player.command': ({
    context,
    payload,
    update,
  }: DungeonEventArgs<PlayerCommandEvent>): PhaseResult => {
    const reduced = applyAuthenticatedPlayerCommand(
      context.world,
      payload.playerId,
      payload.command,
    )
    return updateWorld(context, reduced.state, update, {
      lastCommandReceipt: {
        key: commandResultKey(payload.playerId, payload.commandId),
        digest: payload.digest,
        result: reduced.result,
      },
    })
  },
  'player.connected': ({
    context,
    payload,
    update,
  }: DungeonEventArgs<PresenceEvent>): PhaseResult =>
    updateWorld(context, applyPresence(context.world, payload.playerId, true), update),
  'player.disconnected': ({
    context,
    payload,
    update,
  }: DungeonEventArgs<PresenceEvent>): PhaseResult =>
    updateWorld(context, applyPresence(context.world, payload.playerId, false), update),
  'admin.reset': ({ context, payload, update }: DungeonEventArgs<ResetEvent>): PhaseResult =>
    updateWorld(context, applyAdminReset(context.world, payload.seed), update),
}

const phases = [
  'lobby',
  'ready',
  'generated',
  'exploration',
  'boss',
  'victory',
  'defeat',
  'disconnect',
  'reconnect',
  'rematch',
] as const

export const dungeonWizard = defineWizard(
  {
    name: 'multiplayer-dungeon',
    version: 2,
    description:
      'Runs one party through a dungeon. Each step is a phase of the game that waits for ' +
      'ticks, player commands and presence changes, and ends when the world changes phase.',
    context: boundary.trusted<DungeonWizardContext>(),
    events: {
      'world.tick': boundary.trusted<Record<string, never>>(),
      'player.command': boundary.trusted<PlayerCommandEvent>(),
      'player.connected': boundary.trusted<PresenceEvent>(),
      'player.disconnected': boundary.trusted<PresenceEvent>(),
      'admin.reset': boundary.trusted<ResetEvent>(),
    },
    unmatchedEvents: { buffer: false, ttl: '1s' },
  },
  ({ step, steps }) => {
    // Every phase handles every event, because a disconnect, a reset or a rematch can arrive
    // in any phase. A handler reduces the world in the context and finishes its wait with the
    // phase the world moved to. `next` routes on that output.
    const phase = (description: string) =>
      step({
        description,
        waitFor: handlers,
        targets: phases,
        next: ({ output }) => output,
      })
    return steps(
      {
        lobby: phase('Players join the party and mark themselves ready.'),
        ready: phase('Every player is ready. The next tick generates the dungeon.'),
        generated: phase('The dungeon exists. The next tick starts the exploration.'),
        exploration: phase('The party fights the wardens and collects the objective.'),
        boss: phase('The party fights the dungeon heart.'),
        victory: phase('The party won. Players can ask for a rematch.'),
        defeat: phase('The party lost. Players can ask for a rematch.'),
        disconnect: phase('A player dropped. The game pauses until every player is back.'),
        reconnect: phase('A player came back. The next tick resumes the phase the game left.'),
        rematch: phase('The next tick resets the world for another game.'),
      },
      { start: 'lobby' },
    )
  },
)

export const commandResultKey = (playerId: string, commandId: string): string =>
  `${playerId.length}:${playerId}:${commandId}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const migrateDungeonSnapshot: SnapshotMigration = (snapshot, from) => {
  if (from.name !== dungeonWizard.name || from.version !== 1 || !isRecord(snapshot)) return snapshot
  const wizard = snapshot.wizard
  const state = snapshot.state
  if (!isRecord(wizard) || !isRecord(state) || !isRecord(state.wizard)) return snapshot
  const context = state.context
  if (!isRecord(context) || !('world' in context)) return snapshot
  return {
    ...snapshot,
    wizard: { ...wizard, version: dungeonWizard.version },
    state: {
      ...state,
      wizard: { ...state.wizard, version: dungeonWizard.version },
      context: { world: context.world },
    },
  }
}
