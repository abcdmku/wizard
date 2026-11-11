const phases = new Set([
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
])
const playerStatuses = new Set(['alive', 'downed', 'escaped'])

export function createCommandState() {
  return {
    phase: null,
    pending: null,
    readySent: false,
    rematchSent: false,
    nextDirection: 'east',
    selfStatus: null,
    selfHealth: null,
    worldTickCursor: null,
    tickAdvances: 0,
    rejectionCursor: null,
    draining: false,
    fatal: false,
  }
}

export function enterPhase(state, phase) {
  if (!phases.has(phase)) return false
  if (state.phase === phase) return true
  state.phase = phase
  if (phase === 'lobby') state.readySent = false
  if (phase === 'victory' || phase === 'defeat') state.rematchSent = false
  return true
}

export function nextCommand(state, allowMove) {
  if (state.pending !== null || state.rejectionCursor !== null || state.draining || state.fatal) {
    return null
  }
  if (state.phase === 'lobby' && !state.readySent) {
    state.readySent = true
    return { type: 'ready', ready: true }
  }
  if ((state.phase === 'victory' || state.phase === 'defeat') && !state.rematchSent) {
    state.rematchSent = true
    return { type: 'rematch' }
  }
  if (
    allowMove &&
    state.selfStatus === 'alive' &&
    state.selfHealth > 0 &&
    (state.phase === 'exploration' || state.phase === 'boss')
  ) {
    const direction = state.nextDirection
    state.nextDirection = direction === 'east' ? 'west' : 'east'
    return { type: 'move', direction }
  }
  return null
}

export function holdForRejectionSnapshot(state, cursor) {
  state.pending = null
  state.rejectionCursor = cursor
}

export function releaseRejectionSnapshot(state, cursor) {
  if (state.rejectionCursor === null || !isAuthoritative(cursor, state.rejectionCursor))
    return false
  state.rejectionCursor = null
  return true
}

export function hasAuthoritativePending(state, cursor) {
  return (
    state.pending !== null &&
    state.pending.ack !== null &&
    isAuthoritative(cursor, state.pending.ack)
  )
}

export function recordSelfProjection(state, self) {
  const status = self?.status
  const health = self?.health
  if (!playerStatuses.has(status) || !Number.isInteger(health) || health < 0) return false
  state.selfStatus = status
  state.selfHealth = health
  return true
}

export function observeWorldTick(state, cursor, observedAt, countAdvance = true) {
  const previous = state.worldTickCursor
  const next = { tick: cursor.tick, observedAt }
  if (previous === null) {
    state.worldTickCursor = next
    return { ok: true, advances: 0, intervalMs: null }
  }
  if (cursor.tick < previous.tick) return { ok: false, advances: 0, intervalMs: null }
  if (cursor.tick === previous.tick) return { ok: true, advances: 0, intervalMs: null }
  if (!countAdvance) {
    state.worldTickCursor = next
    return { ok: true, advances: 0, intervalMs: null }
  }
  const intervalMs = Math.max(0, observedAt - previous.observedAt)
  state.tickAdvances += 1
  state.worldTickCursor = next
  return { ok: true, advances: 1, intervalMs }
}

export function tickRateHz(tickAdvances, openedAt, activeEndedAt) {
  const activeMs = activeEndedAt - openedAt
  return activeMs > 0 ? tickAdvances / (activeMs / 1_000) : 0
}

export function coordinates(frame) {
  const sequence = frame?.sequence
  const tick = frame?.tick
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    typeof tick !== 'number' ||
    !Number.isInteger(tick) ||
    tick < 0
  ) {
    return null
  }
  return { sequence, tick }
}

export function snapshotCursor(frame) {
  const cursor = coordinates(frame)
  const epoch = frame?.epoch
  if (cursor === null || typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) {
    return null
  }
  return { epoch, ...cursor }
}

export function isRegressedSnapshot(previous, next) {
  if (previous === null) return false
  if (next.epoch !== previous.epoch) return next.epoch < previous.epoch
  return next.sequence < previous.sequence
}

export function observeAuthoritativeSnapshot(state, frame, observedAt, activeMs) {
  const cursor = snapshotCursor(frame)
  const previous = state.lastSnapshotCursor
  if (
    cursor === null ||
    isRegressedSnapshot(previous, cursor) ||
    !recordSelfProjection(state, frame?.projection?.self) ||
    !enterPhase(state, frame?.projection?.phase)
  ) {
    return { ok: false, cursor: null, tickObservation: null, lateSnapshot: false }
  }
  const tickObservation = observeWorldTick(state, cursor, observedAt, !state.draining)
  if (!tickObservation.ok) {
    return { ok: false, cursor: null, tickObservation: null, lateSnapshot: false }
  }
  const advanced =
    previous === null || cursor.epoch > previous.epoch || cursor.sequence > previous.sequence
  state.lastSnapshotCursor = cursor
  let lateSnapshot = false
  if (advanced && !state.draining && !state.closed) {
    state.lastAuthoritativeSnapshotAt = observedAt
    if (!state.lateSnapshotRecorded && observedAt - state.openedAt >= activeMs * 0.95) {
      state.lateSnapshotRecorded = true
      lateSnapshot = true
    }
  }
  return { ok: true, cursor, tickObservation, lateSnapshot }
}

export function isAuthoritative(snapshot, ack) {
  return snapshot.sequence >= ack.sequence && snapshot.tick >= ack.tick
}

export function ratio(completed, sent) {
  return sent === 0 ? 0 : completed / sent
}
