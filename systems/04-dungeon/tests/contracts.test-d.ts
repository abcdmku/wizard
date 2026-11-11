import type { ProjectionScope, Run } from '@openwizard/core'
import { dungeonProjection } from '@wizard/dungeon-server'
import type {
  AuthenticatedCommand,
  ClientMessage,
  DungeonContext,
  DungeonEvent,
  DungeonInput,
  DungeonOutput,
  DungeonState,
  JoinDungeonInput,
  ParsedDungeonState,
  PlayerProjection,
  ProtocolError,
  ServerFrame,
  Viewer,
} from '@wizard/dungeon-shared'
import { projectParsedDungeonForViewer } from '@wizard/dungeon-shared'
import { expectTypeOf } from 'vitest'

expectTypeOf<DungeonContext>().toMatchTypeOf<{
  partyId: string
  dungeonId: string
  instanceId: string
  epoch: number
  minPlayers: 2
  maxPlayers: number
  createdAt: string
}>()

expectTypeOf<DungeonInput>().toEqualTypeOf<JoinDungeonInput>()
expectTypeOf<DungeonInput>().toMatchTypeOf<{
  partyId: string
  displayName: string
}>()

expectTypeOf<DungeonOutput>().toMatchTypeOf<{
  partyId: string
  instanceId: string
  outcome: 'victory' | 'defeat' | 'abandoned'
  completedAt: string
  survivingPlayerIds: string[]
  finalTick: number
}>()

expectTypeOf<DungeonEvent['type']>().toEqualTypeOf<
  'world.tick' | 'player.command' | 'player.connected' | 'player.disconnected'
>()

expectTypeOf<ProtocolError['code']>().toEqualTypeOf<
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-command'
  | 'not-found'
  | 'sequence-conflict'
  | 'out-of-range'
  | 'key-not-owned'
  | 'door-already-open'
  | 'rate-limited'
  | 'server-error'
>()
expectTypeOf<ProtocolError>().toMatchTypeOf<{
  code: string
  message: string
  retryable: boolean
}>()

type Self = PlayerProjection['self']
type Teammate = PlayerProjection['teammates'][number]

expectTypeOf<Self['inventory']['items']>().toBeArray()
expectTypeOf<Self['effects']>().toBeArray()
expectTypeOf<Teammate['publicItemCount']>().toBeNumber()

declare const teammate: Teammate
// @ts-expect-error Teammate inventory is private to its Viewer scope.
teammate.inventory
// @ts-expect-error Teammate effect names and durations are private.
teammate.effects

declare const clientMessage: ClientMessage
// @ts-expect-error Trusted Viewer data cannot enter a client command.
clientMessage.viewer
// @ts-expect-error The server derives player identity from the connection.
clientMessage.playerId

declare const frame: ServerFrame
// @ts-expect-error A frame never serializes the trusted Viewer object.
frame.viewer
// @ts-expect-error Authentication credentials never enter server frames.
frame.token

declare const authenticated: AuthenticatedCommand
expectTypeOf(authenticated.viewer).toEqualTypeOf<Readonly<Viewer>>()
expectTypeOf(authenticated.message).toMatchTypeOf<ClientMessage>()

declare const viewer: Viewer
declare const dungeonState: DungeonState
declare const parsedDungeonState: ParsedDungeonState
declare const run: Run<typeof dungeonProjection.wizard>
expectTypeOf<ProjectionScope<typeof dungeonProjection>>().toEqualTypeOf<Viewer>()
expectTypeOf(run.project(dungeonProjection, viewer)).toEqualTypeOf<PlayerProjection>()
// @ts-expect-error The dungeon projection requires an immutable Viewer scope.
run.project(dungeonProjection)
expectTypeOf(projectParsedDungeonForViewer(parsedDungeonState, viewer)).toEqualTypeOf<
  PlayerProjection | undefined
>()
// @ts-expect-error The fast projector only accepts a schema-parsed state wrapper.
projectParsedDungeonForViewer(dungeonState, viewer)
