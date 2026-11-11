import { check, fail } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import ws from 'k6/ws'
import { recordAckRejection } from './k6-ack-metrics.js'
import { playerCountFor, profileNames, profiles, thresholdsFor } from './k6-config.js'
import { setupParties } from './k6-setup.js'
import { buildSummary } from './k6-summary.js'
import { signPlayerToken, utf8Bytes } from './k6-support.js'
import {
  coordinates,
  createCommandState,
  hasAuthoritativePending,
  holdForRejectionSnapshot,
  nextCommand,
  observeAuthoritativeSnapshot,
  releaseRejectionSnapshot,
  tickRateHz,
} from './state-machine.js'

const drainMs = 5_000
const profileName = __ENV.DUNGEON_LOAD_PROFILE ?? 'smoke'
const profile = profiles[profileName]
if (profile === undefined) {
  throw new Error(`unknown profile '${profileName}'; use ${profileNames.join(', ')}`)
}

const commandToFrame = new Trend('command_to_frame_ms', true)
const fullFrameBytes = new Trend('full_frame_bytes')
const lastSnapshotOffset = new Trend('last_authoritative_snapshot_offset_ms', true)
const activeDuration = new Trend('connection_active_duration_ms', true)
const worldTickAdvances = new Trend('world_tick_advances_per_vu')
const worldTickRate = new Trend('world_tick_rate_hz')
const worldTickInterval = new Trend('world_tick_interval_ms', true)
const worldTickSampledVus = new Counter('world_tick_sampled_vus')
const worldTickIntervalSamples = new Counter('world_tick_interval_samples')
const fullFrameBytesTotal = new Counter('full_frame_bytes_total')
const fullFrameCount = new Counter('full_frame_count')
const oversizedFullFrames = new Counter('oversized_full_frames')
const authoritativeFrames = new Counter('authoritative_command_frames')
const protocolErrors = new Counter('protocol_errors')
const stalePendingCommands = new Counter('stale_pending_commands')
const commandsSent = new Counter('commands_sent')
const commandsCompleted = new Counter('commands_completed')
const commandsResolved = new Counter('commands_resolved')
const commandsLifecycleRejected = new Counter('commands_lifecycle_rejected')
const commandsUnresolved = new Counter('commands_unresolved')
const resolutionRatio = new Rate('command_resolution_ratio')
const authoritativeCompletionRatio = new Rate('authoritative_completion_ratio')
const connectionsOpened = new Counter('connections_opened')
const connectionsClosed = new Counter('connections_closed')
const completedConnections = new Counter('completed_connections')
const sampledConnections = new Counter('sampled_connections')
const lateSnapshotVus = new Counter('late_sample_vus')
const earlyCloses = new Counter('early_connection_closes')

const playerCount = playerCountFor(profile)
const httpUrl = __ENV.DUNGEON_API_URL ?? 'http://127.0.0.1:4410'
const wsUrl = __ENV.DUNGEON_WS_URL ?? 'ws://127.0.0.1:4410/ws'
const seedKey = __ENV.DUNGEON_SEED_KEY ?? 'local-seed-key'
const jwtSecret = __ENV.DUNGEON_JWT_SECRET ?? 'local-jwt-secret-change-me'

export const options = {
  scenarios: {
    dungeon_parties: {
      executor: 'per-vu-iterations',
      vus: playerCount,
      iterations: 1,
      maxDuration: profile.deadline,
    },
  },
  thresholds: thresholdsFor(profile),
}

export function setup() {
  return { parties: setupParties(httpUrl, seedKey, profile) }
}

function abandonPending(state, stale) {
  if (state.pending === null) return
  commandsUnresolved.add(1)
  if (stale) stalePendingCommands.add(1)
  resolutionRatio.add(false)
  authoritativeCompletionRatio.add(false)
  state.unresolved += 1
  state.pending = null
}

function closeSocket(socket, state) {
  if (state.closing || state.closed) return
  state.closing = true
  socket.close()
}

function beginDrain(socket, state) {
  if (state.draining) return
  state.draining = true
  state.activeEndedAt = Date.now()
  activeDuration.add(state.activeEndedAt - state.openedAt)
  if (state.pending === null) {
    closeSocket(socket, state)
    return
  }
  socket.setTimeout(() => {
    if (state.closed) return
    abandonPending(state, true)
    closeSocket(socket, state)
  }, drainMs)
}

function protocolFailure(socket, state) {
  protocolErrors.add(1)
  state.fatal = true
  abandonPending(state, false)
  beginDrain(socket, state)
}

function sendCommand(socket, state, command) {
  state.commandSequence += 1
  const commandId = `${state.playerId}-${state.commandSequence}`
  state.pending = { commandId, commandType: command.type, sentAt: Date.now(), ack: null }
  state.sent += 1
  commandsSent.add(1)
  socket.send(JSON.stringify({ type: 'command', partyId: state.partyId, commandId, command }))
}

function drive(socket, state, allowMove) {
  const command = nextCommand(state, allowMove)
  if (command !== null) sendCommand(socket, state, command)
}

function completePending(socket, state) {
  const pending = state.pending
  if (pending === null) return
  const now = Date.now()
  commandToFrame.add(now - pending.sentAt)
  authoritativeFrames.add(1)
  commandsCompleted.add(1)
  commandsResolved.add(1)
  resolutionRatio.add(true)
  authoritativeCompletionRatio.add(true)
  state.completed += 1
  state.resolved += 1
  state.pending = null
  if (state.draining) closeSocket(socket, state)
}

function recordSnapshot(socket, state, frame, bytes) {
  const observedAt = Date.now()
  fullFrameBytes.add(bytes)
  fullFrameBytesTotal.add(bytes)
  fullFrameCount.add(1)
  if (bytes > 25_000) oversizedFullFrames.add(1)
  const observation = observeAuthoritativeSnapshot(state, frame, observedAt, profile.activeMs)
  if (!observation.ok) {
    protocolFailure(socket, state)
    return
  }
  const { cursor, tickObservation } = observation
  if (observation.lateSnapshot) lateSnapshotVus.add(1)
  if (tickObservation.intervalMs !== null) {
    worldTickInterval.add(tickObservation.intervalMs)
    worldTickIntervalSamples.add(1)
  }
  releaseRejectionSnapshot(state, cursor)
  if (hasAuthoritativePending(state, cursor)) completePending(socket, state)
  drive(socket, state, false)
}

function recordAck(socket, state, frame) {
  const pending = state.pending
  if (pending === null || frame.commandId !== pending.commandId) {
    protocolFailure(socket, state)
    return
  }
  if (frame.ok !== true) {
    const classified = recordAckRejection(pending, frame)
    const ack = coordinates(frame)
    if (classified.disposition !== 'lifecycle' || ack === null) {
      protocolFailure(socket, state)
      return
    }
    commandsLifecycleRejected.add(1)
    commandsResolved.add(1)
    resolutionRatio.add(true)
    authoritativeCompletionRatio.add(false)
    state.rejected += 1
    state.resolved += 1
    holdForRejectionSnapshot(state, ack)
    return
  }
  const ack = coordinates(frame)
  if (ack === null) {
    protocolFailure(socket, state)
    return
  }
  pending.ack = ack
}

function recordFrame(socket, state, raw) {
  const text = typeof raw === 'string' ? raw : String(raw)
  let frame
  try {
    frame = JSON.parse(text)
  } catch {
    protocolFailure(socket, state)
    return
  }
  if (frame.type === 'snapshot') recordSnapshot(socket, state, frame, utf8Bytes(text))
  else if (frame.type === 'ack') recordAck(socket, state, frame)
  else if (frame.type !== 'welcome') protocolFailure(socket, state)
}

function recordClose(state) {
  if (state.closed) return
  state.closed = true
  abandonPending(state, true)
  connectionsClosed.add(1)
  const endedAt = state.activeEndedAt || Date.now()
  worldTickAdvances.add(state.tickAdvances)
  worldTickRate.add(tickRateHz(state.tickAdvances, state.openedAt, endedAt))
  worldTickSampledVus.add(1)
  if (endedAt - state.openedAt < profile.activeMs - 1_000) earlyCloses.add(1)
  lastSnapshotOffset.add(
    state.lastAuthoritativeSnapshotAt === 0
      ? 0
      : state.lastAuthoritativeSnapshotAt - state.openedAt,
  )
  if (state.completed > 0) sampledConnections.add(1)
  if (!state.fatal && state.sent > 0 && state.sent === state.resolved && state.unresolved === 0) {
    completedConnections.add(1)
  }
}

export default function run(data) {
  const playerIndex = (__VU - 1) % playerCount
  const partyIndex = Math.floor(playerIndex / profile.playersPerParty)
  const party = data.parties[partyIndex]
  if (party === undefined) fail(`missing party ${partyIndex}`)
  const player = party.players[playerIndex % profile.playersPerParty]
  if (player === undefined) fail(`missing player ${playerIndex}`)
  const state = {
    ...createCommandState(),
    partyId: party.partyId,
    playerId: player.id,
    commandSequence: 0,
    openedAt: 0,
    activeEndedAt: 0,
    lastAuthoritativeSnapshotAt: 0,
    lastSnapshotCursor: null,
    lateSnapshotRecorded: false,
    sent: 0,
    completed: 0,
    resolved: 0,
    rejected: 0,
    unresolved: 0,
    closing: false,
    closed: false,
  }
  const token = signPlayerToken(jwtSecret, player.id, party.partyId)
  const response = ws.connect(`${wsUrl}?token=${encodeURIComponent(token)}`, {}, (socket) => {
    socket.on('open', () => {
      state.openedAt = Date.now()
      connectionsOpened.add(1)
      socket.setTimeout(() => beginDrain(socket, state), profile.activeMs)
    })
    socket.on('message', (raw) => recordFrame(socket, state, raw))
    socket.on('error', () => {
      if (!state.closing && !state.closed) protocolFailure(socket, state)
    })
    socket.on('close', () => recordClose(state))
    socket.setInterval(() => drive(socket, state, true), profile.driveIntervalMs)
  })
  if (!check(response, { 'websocket upgrade succeeds': (result) => result?.status === 101 })) {
    protocolErrors.add(1)
  }
}
export function handleSummary(data) {
  const summary = buildSummary(data, profileName, profile, playerCount)
  return { stdout: `DUNGEON_LOAD_RESULT ${JSON.stringify(summary)}\n` }
}
