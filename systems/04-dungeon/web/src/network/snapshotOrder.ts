import type { SnapshotFrame } from '@wizard/dungeon-shared'

export type SnapshotCursor = Readonly<Pick<SnapshotFrame, 'partyId' | 'epoch' | 'sequence'>>
export type SnapshotOrder = 'newer' | 'duplicate' | 'stale'

export interface SnapshotDecision {
  order: SnapshotOrder
  replaceProjection: boolean
  restoreConnection: boolean
}

export const compareSnapshot = (
  current: SnapshotCursor | null,
  next: SnapshotCursor,
): SnapshotOrder => {
  if (current === null || current.partyId !== next.partyId) return 'newer'
  if (next.epoch < current.epoch) return 'stale'
  if (next.epoch > current.epoch) return 'newer'
  if (next.sequence < current.sequence) return 'stale'
  return next.sequence === current.sequence ? 'duplicate' : 'newer'
}

export const decideSnapshot = (
  current: SnapshotCursor | null,
  next: SnapshotCursor,
  hasProjection: boolean,
): SnapshotDecision => {
  const order = compareSnapshot(current, next)
  return {
    order,
    replaceProjection: order === 'newer' || !hasProjection,
    restoreConnection: order !== 'stale',
  }
}

export const snapshotCursor = (frame: SnapshotFrame): SnapshotCursor => ({
  partyId: frame.partyId,
  epoch: frame.epoch,
  sequence: frame.sequence,
})
