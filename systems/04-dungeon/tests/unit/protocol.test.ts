import {
  applyAuthenticatedPlayerCommand,
  applyPresence,
  createInitialWorld,
  projectState,
  simulateTick,
} from '@wizard/dungeon-server'
import {
  AuthenticatedCommandSchema,
  ClientMessageSchema,
  MAX_SERVER_FRAME_BYTES,
  ProtocolErrorSchema,
  ServerFrameSchema,
  serializedFrameBytes,
  ViewerSchema,
} from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'

const message = {
  type: 'command',
  partyId: 'party-a',
  commandId: 'command-1',
  expectedSequence: 7,
  command: { type: 'move', direction: 'east' },
} as const

const viewer = {
  tenantId: 'tenant-a',
  partyId: 'party-a',
  playerId: 'player-a',
  sessionId: 'session-a',
} as const

describe('dungeon wire boundaries', () => {
  it('parses the canonical command envelope and rejects spoofed identity fields', () => {
    expect(ClientMessageSchema.parse(message)).toEqual(message)
    expect(
      ClientMessageSchema.safeParse({
        ...message,
        playerId: 'player-spoofed',
        command: { ...message.command, tenantId: 'tenant-foreign' },
      }).success,
    ).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        ...message,
        command: { type: 'move', direction: 'sideways' },
      }).success,
    ).toBe(false)
    expect(ClientMessageSchema.safeParse({ type: 'command' }).success).toBe(false)
  })

  it('keeps Viewer immutable and validates party scope before authentication enters the flow', () => {
    const parsed = ViewerSchema.parse(viewer)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(ViewerSchema.safeParse({ ...viewer, token: 'private-token' }).success).toBe(false)
    expect(
      AuthenticatedCommandSchema.safeParse({
        viewer: { ...viewer, partyId: 'party-foreign' },
        message,
        receivedAt: '2026-08-23T17:00:00.000Z',
      }).success,
    ).toBe(false)
  })

  it('rejects auth data smuggled into server frames', () => {
    const welcome = {
      protocolVersion: 1,
      type: 'welcome',
      partyId: 'party-a',
      instanceId: 'party:party-a',
      epoch: 0,
      sequence: 9,
      tick: 4,
      playerId: 'player-a',
    } as const
    expect(ServerFrameSchema.safeParse(welcome).success).toBe(true)
    expect(ServerFrameSchema.safeParse({ ...welcome, viewer }).success).toBe(false)
    expect(ServerFrameSchema.safeParse({ ...welcome, token: 'private-token' }).success).toBe(false)
  })

  it('keeps errors bounded and reports the exact UTF-8 frame size', () => {
    const error = {
      code: 'invalid-command',
      message: 'bad direction',
      retryable: false,
    } as const
    expect(ProtocolErrorSchema.safeParse(error).success).toBe(true)
    expect(ProtocolErrorSchema.safeParse({ ...error, stack: 'private stack' }).success).toBe(false)

    const frame = {
      protocolVersion: 1,
      type: 'ack',
      partyId: 'party-a',
      sequence: 9,
      tick: 4,
      commandId: 'command-1',
      ok: false,
      ...error,
    } as const
    const parsed = ServerFrameSchema.parse(frame)
    expect(serializedFrameBytes(parsed)).toBe(
      new TextEncoder().encode(JSON.stringify(frame)).length,
    )
    expect(serializedFrameBytes(parsed)).toBeLessThan(MAX_SERVER_FRAME_BYTES)
  })

  it('reproduces the four-player seed-4242 full-frame byte baseline', () => {
    const partyId = 'frame-measurement-party'
    const roster = [
      { id: 'player-one', name: 'Ada' },
      { id: 'player-two', name: 'Lin' },
      { id: 'player-three', name: 'Grace' },
      { id: 'player-four', name: 'Edsger' },
    ] as const
    let state = createInitialWorld(partyId, 4_242, roster)
    for (const player of roster) state = applyPresence(state, player.id, true)
    for (const player of roster) {
      state = applyAuthenticatedPlayerCommand(state, player.id, {
        type: 'ready',
        ready: true,
      }).state
    }
    state = simulateTick(simulateTick(state))
    expect(state).toMatchObject({ phase: 'exploration', tick: 2 })

    const frameBytes = roster.map((player) => {
      const projection = projectState(
        state,
        {
          tenantId: partyId,
          partyId,
          playerId: player.id,
          sessionId: `session-${player.id}`,
        },
        100,
        1,
      )
      const frame = ServerFrameSchema.parse({
        type: 'snapshot',
        protocolVersion: 1,
        partyId,
        instanceId: `party:${partyId}`,
        epoch: 1,
        sequence: 100,
        tick: 2,
        sentAt: '1970-01-01T00:00:00.000Z',
        projection,
      })
      return serializedFrameBytes(frame)
    })

    expect(frameBytes).toEqual([2_867, 2_867, 2_867, 2_867])
    expect(Math.max(...frameBytes)).toBeLessThan(MAX_SERVER_FRAME_BYTES)
  })
})
