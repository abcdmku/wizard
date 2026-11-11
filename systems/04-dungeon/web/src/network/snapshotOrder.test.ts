import { describe, expect, it } from 'vitest'
import { compareSnapshot, decideSnapshot, type SnapshotCursor } from './snapshotOrder'

const cursor = (epoch: number, sequence: number, partyId = 'party-1'): SnapshotCursor => ({
  partyId,
  epoch,
  sequence,
})

describe('snapshot ordering', () => {
  it('rejects an older sequence in the current epoch', () => {
    expect(compareSnapshot(cursor(2, 10), cursor(2, 9))).toBe('stale')
  })

  it('rejects a lower epoch even when its sequence is higher', () => {
    expect(compareSnapshot(cursor(2, 10), cursor(1, 99))).toBe('stale')
  })

  it('accepts a higher sequence or epoch', () => {
    expect(compareSnapshot(cursor(2, 10), cursor(2, 11))).toBe('newer')
    expect(compareSnapshot(cursor(2, 10), cursor(3, 0))).toBe('newer')
  })

  it('uses an exact reconnect snapshot to restore status without replacing state', () => {
    expect(decideSnapshot(cursor(2, 10), cursor(2, 10), true)).toEqual({
      order: 'duplicate',
      replaceProjection: false,
      restoreConnection: true,
    })
  })

  it('does not let stale data restore a connection', () => {
    expect(decideSnapshot(cursor(2, 10), cursor(2, 9), true)).toEqual({
      order: 'stale',
      replaceProjection: false,
      restoreConnection: false,
    })
  })

  it('starts fresh when the party changes', () => {
    expect(compareSnapshot(cursor(2, 10), cursor(1, 1, 'party-2'))).toBe('newer')
  })
})
