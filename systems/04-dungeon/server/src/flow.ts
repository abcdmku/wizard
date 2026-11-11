import { boundary, defineWizard, type SnapshotMigration } from '@openwizard/core'
import type { DomainResult, PlayerCommand, WorldState } from './domain.js'
import { simulateTick } from './engine.js'
import { applyAdminReset, applyAuthenticatedPlayerCommand, applyPresence } from './server.js'

export interface DungeonFlowContext {
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
  readonly context: DungeonFlowContext
  readonly payload: P
  readonly update: (patch: Partial<DungeonFlowContext>) => void
}

const updateWorld = (
  context: DungeonFlowContext,
  nextWorld: WorldState,
  update: DungeonEventArgs<unknown>['update'],
  patch: Partial<DungeonFlowContext> = {},
): PhaseResult => {
  update(contextPatch(context, nextWorld, patch))
  return nextWorld.phase === context.world.phase ? { keep: true } : { done: nextWorld.phase }
}

const contextPatch = (
  context: DungeonFlowContext,
  nextWorld: WorldState,
  patch: Partial<DungeonFlowContext> = {},
): Partial<DungeonFlowContext> => ({
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

export const dungeonFlow = defineWizard(
  {
    name: 'multiplayer-dungeon',
    version: 2,
    context: boundary.trusted<DungeonFlowContext>(),
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
    // Event handlers only report completion. The declared routing edges select the
    // phase from committed context, including disconnects, resets and rematches.
    const phase = () =>
      step({
        waitFor: handlers,
        targets: phases,
        next: ({ context }) => context.world.phase,
      })
    return steps(
      {
        lobby: phase(),
        ready: phase(),
        generated: phase(),
        exploration: phase(),
        boss: phase(),
        victory: phase(),
        defeat: phase(),
        disconnect: phase(),
        reconnect: phase(),
        rematch: phase(),
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
  if (from.name !== dungeonFlow.name || from.version !== 1 || !isRecord(snapshot)) return snapshot
  const flow = snapshot.flow
  const state = snapshot.state
  if (!isRecord(flow) || !isRecord(state) || !isRecord(state.flow)) return snapshot
  const context = state.context
  if (!isRecord(context) || !('world' in context)) return snapshot
  return {
    ...snapshot,
    flow: { ...flow, version: dungeonFlow.version },
    state: {
      ...state,
      flow: { ...state.flow, version: dungeonFlow.version },
      context: { world: context.world },
    },
  }
}
