import type { AckFrame, ClientCommand, Direction, ErrorFrame } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import { type ControlDirection, movementFor } from '../game/usePlayerControls'
import { MovementCommandGate } from './movementCommandGate'

const poll = (
  gate: MovementCommandGate,
  held: readonly ControlDirection[],
  commandId: string,
  sent: Direction[],
): void => {
  const direction = movementFor(held)
  if (direction === null) return
  const command: ClientCommand = { type: 'move', direction }
  if (gate.start(commandId, command)) sent.push(direction)
}

const ack = (commandId: string): AckFrame => ({
  protocolVersion: 1,
  partyId: 'party-1',
  sequence: 1,
  tick: 1,
  type: 'ack',
  commandId,
  ok: true,
  replayed: false,
})

const error = (
  commandId: string | null,
  code: ErrorFrame['error']['code'] = 'rate-limited',
): ErrorFrame => ({
  protocolVersion: 1,
  partyId: 'party-1',
  sequence: 1,
  tick: 1,
  type: 'error',
  commandId,
  error: { code, message: 'command failed', retryable: true },
})

describe('movement command backpressure', () => {
  it('allows only one movement command in flight', () => {
    const gate = new MovementCommandGate()
    const sent: Direction[] = []
    poll(gate, ['right'], 'move-1', sent)
    poll(gate, ['right'], 'move-2', sent)
    expect(sent).toEqual(['east'])
    expect(gate.inFlight).toBe('move-1')
  })

  it('continues a held direction after its matching ack', () => {
    const gate = new MovementCommandGate()
    const sent: Direction[] = []
    poll(gate, ['right'], 'move-1', sent)
    expect(gate.settleFrame(ack('another-command'))).toBe(false)
    expect(gate.settleFrame(ack('move-1'))).toBe(true)
    poll(gate, ['right'], 'move-2', sent)
    expect(sent).toEqual(['east', 'east'])
  })

  it('does not retain a movement backlog after key-up', () => {
    const gate = new MovementCommandGate()
    const sent: Direction[] = []
    poll(gate, ['right'], 'move-1', sent)
    poll(gate, ['right'], 'move-2', sent)
    poll(gate, ['right'], 'move-3', sent)
    gate.settle('move-1')
    poll(gate, [], 'move-4', sent)
    expect(sent).toEqual(['east'])
    expect(gate.inFlight).toBeNull()
  })

  it('recovers after a close or session reset clears the gate', () => {
    const gate = new MovementCommandGate()
    const sent: Direction[] = []
    poll(gate, ['up'], 'old-session', sent)
    gate.clear()
    poll(gate, ['left'], 'new-session', sent)
    expect(sent).toEqual(['north', 'west'])
    expect(gate.inFlight).toBe('new-session')
  })

  it('releases only a command-correlated error', () => {
    const gate = new MovementCommandGate()
    expect(gate.start('move-1', { type: 'move', direction: 'east' })).toBe(true)
    expect(gate.settleFrame(error(null))).toBe(false)
    expect(gate.settleFrame(error('move-1'))).toBe(true)
    expect(gate.inFlight).toBeNull()
  })

  it('releases a move for an uncorrelated internal server fault only', () => {
    const gate = new MovementCommandGate()
    expect(gate.start('move-1', { type: 'move', direction: 'east' })).toBe(true)
    expect(gate.settleFrame(error(null, 'invalid-command'))).toBe(false)
    expect(gate.settleFrame(error(null, 'forbidden'))).toBe(false)
    expect(gate.inFlight).toBe('move-1')
    expect(gate.settleFrame(error(null, 'server-error'))).toBe(true)
    expect(gate.inFlight).toBeNull()
  })

  it('never blocks discrete actions', () => {
    const gate = new MovementCommandGate()
    expect(gate.start('move-1', { type: 'move', direction: 'east' })).toBe(true)
    expect(gate.start('attack-1', { type: 'attack' })).toBe(true)
    expect(gate.inFlight).toBe('move-1')
  })
})
