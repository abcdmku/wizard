import { describe, expect, it } from 'vitest'
import {
  AuthenticatedCommandSchema,
  ClientMessageSchema,
  SeedPlayerSchema,
  ServerFrameSchema,
  type Viewer,
} from './index.js'

const now = '2026-08-23T12:00:00.000Z'
const viewer: Viewer = {
  tenantId: 'tenant-1',
  partyId: 'party-1',
  playerId: 'player-1',
  sessionId: 'session-1',
}

describe('identity boundaries', () => {
  it('parses seed players through the shared player boundaries', () => {
    expect(SeedPlayerSchema.parse({ id: ' player-3 ', name: ' Cyra ' })).toEqual({
      id: 'player-3',
      name: 'Cyra',
    })
    expect(SeedPlayerSchema.safeParse({ id: 'player-3', name: '', role: 'admin' }).success).toBe(
      false,
    )
  })

  it('rejects player identity in external command messages', () => {
    const valid = {
      type: 'command',
      partyId: 'party-1',
      commandId: 'command-1',
      command: { type: 'move', direction: 'north' },
    }
    expect(ClientMessageSchema.safeParse(valid).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...valid, playerId: 'spoofed' }).success).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        ...valid,
        command: { ...valid.command, playerId: 'spoofed' },
      }).success,
    ).toBe(false)
  })

  it('binds a parsed command to the trusted viewer party', () => {
    const message = ClientMessageSchema.parse({
      type: 'command',
      partyId: 'party-1',
      commandId: 'command-1',
      command: { type: 'ready', ready: true },
    })
    if (message.type !== 'command') throw new Error('expected command message')
    expect(AuthenticatedCommandSchema.safeParse({ viewer, message, receivedAt: now }).success).toBe(
      true,
    )
    expect(
      AuthenticatedCommandSchema.safeParse({
        viewer,
        message: { ...message, partyId: 'party-2' },
        receivedAt: now,
      }).success,
    ).toBe(false)
  })
})

describe('server frames', () => {
  it('rejects patch frames until the measured gate enables them', () => {
    expect(
      ServerFrameSchema.safeParse({
        type: 'patch',
        protocolVersion: 1,
        partyId: 'party-1',
        instanceId: 'instance-1',
        epoch: 1,
        baseSequence: 7,
        sequence: 8,
        tick: 13,
        sentAt: now,
        operations: [{ op: 'replace', path: '/tick', value: 13 }],
      }).success,
    ).toBe(false)
  })
})
