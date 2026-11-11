import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAckFailure } from './ack-policy.js'
import { activePartiesFromHealth } from './health.js'
import {
  minimumTickAdvances,
  playerCountFor,
  profileNames,
  profiles,
  thresholdsFor,
} from './k6-config.js'
import { buildSummary } from './k6-summary.js'
import {
  coordinates,
  createCommandState,
  enterPhase,
  hasAuthoritativePending,
  holdForRejectionSnapshot,
  isAuthoritative,
  isRegressedSnapshot,
  nextCommand,
  observeWorldTick,
  ratio,
  recordSelfProjection,
  releaseRejectionSnapshot,
  snapshotCursor,
  tickRateHz,
} from './state-machine.js'

test('drives one ready and rematch per lifecycle while moves stay single-flight', () => {
  const state = createCommandState()
  assert.equal(nextCommand(state, true), null)
  assert.equal(enterPhase(state, 'lobby'), true)
  assert.deepEqual(nextCommand(state, false), { type: 'ready', ready: true })
  assert.equal(nextCommand(state, false), null)

  assert.equal(enterPhase(state, 'exploration'), true)
  assert.equal(recordSelfProjection(state, { status: 'alive', health: 100 }), true)
  assert.deepEqual(nextCommand(state, true), { type: 'move', direction: 'east' })
  state.pending = { commandId: 'move-1' }
  assert.equal(nextCommand(state, true), null)
  state.pending = null
  assert.deepEqual(nextCommand(state, true), { type: 'move', direction: 'west' })

  assert.equal(enterPhase(state, 'defeat'), true)
  assert.deepEqual(nextCommand(state, false), { type: 'rematch' })
  assert.equal(nextCommand(state, false), null)
  assert.equal(enterPhase(state, 'rematch'), true)
  assert.equal(enterPhase(state, 'lobby'), true)
  assert.deepEqual(nextCommand(state, false), { type: 'ready', ready: true })
})

test('records scoped health and suppresses moves while the player is downed', () => {
  const state = createCommandState()
  assert.equal(enterPhase(state, 'exploration'), true)
  assert.equal(recordSelfProjection(state, { status: 'downed', health: 0 }), true)
  assert.equal(state.selfStatus, 'downed')
  assert.equal(state.selfHealth, 0)
  assert.equal(nextCommand(state, true), null)
  assert.equal(recordSelfProjection(state, { status: 'alive', health: 12 }), true)
  assert.deepEqual(nextCommand(state, true), { type: 'move', direction: 'east' })
  assert.equal(recordSelfProjection(state, { status: 'alive', health: -1 }), false)
  assert.equal(recordSelfProjection(state, { status: 'unknown', health: 1 }), false)
})

test('recovers only the two evidenced move lifecycle rejections', () => {
  const pending = { commandType: 'move' }
  const failure = (message, retryable = false) => ({
    ok: false,
    code: 'invalid-command',
    message,
    retryable,
  })
  assert.equal(classifyAckFailure(pending, failure('party is not active')).disposition, 'lifecycle')
  assert.equal(
    classifyAckFailure(pending, failure('defeated players can only request a rematch')).disposition,
    'lifecycle',
  )
  assert.equal(
    classifyAckFailure({ commandType: 'ready' }, failure('party is not active')).disposition,
    'fatal',
  )
  assert.equal(
    classifyAckFailure(pending, failure('party is not active', true)).disposition,
    'fatal',
  )
  assert.equal(classifyAckFailure(pending, failure('party is not in lobby')).disposition, 'fatal')
  assert.equal(classifyAckFailure(pending, { ok: false }).reason, 'malformed')
})

test('blocks retry until a snapshot reaches the rejection ACK cursor', () => {
  const state = createCommandState()
  enterPhase(state, 'exploration')
  recordSelfProjection(state, { status: 'alive', health: 50 })
  state.pending = { commandId: 'move-1', commandType: 'move' }
  holdForRejectionSnapshot(state, { sequence: 9, tick: 12 })
  assert.equal(nextCommand(state, true), null)
  assert.equal(releaseRejectionSnapshot(state, { sequence: 8, tick: 12 }), false)
  assert.equal(releaseRejectionSnapshot(state, { sequence: 9, tick: 11 }), false)
  assert.equal(releaseRejectionSnapshot(state, { sequence: 9, tick: 12 }), true)
  assert.deepEqual(nextCommand(state, true), { type: 'move', direction: 'east' })
})

test('rejects malformed cursors and correlates both sequence and tick', () => {
  assert.equal(coordinates({ sequence: 1 }), null)
  assert.equal(coordinates({ sequence: 1.5, tick: 2 }), null)
  assert.equal(coordinates({ sequence: 1, tick: -1 }), null)
  assert.deepEqual(coordinates({ sequence: 1, tick: 2 }), { sequence: 1, tick: 2 })
  assert.deepEqual(coordinates({ sequence: 4, tick: 7 }), { sequence: 4, tick: 7 })
  assert.equal(isAuthoritative({ sequence: 4, tick: 7 }, { sequence: 4, tick: 7 }), true)
  assert.equal(isAuthoritative({ sequence: 5, tick: 6 }, { sequence: 4, tick: 7 }), false)
})

test('rejects regressed snapshot epochs and sequences independently of tick cadence', () => {
  const previous = { epoch: 2, sequence: 10, tick: 40 }
  assert.equal(snapshotCursor({ sequence: 10, tick: 40 }), null)
  assert.equal(snapshotCursor({ epoch: 1.5, sequence: 10, tick: 40 }), null)
  assert.deepEqual(snapshotCursor(previous), previous)
  assert.equal(isRegressedSnapshot(previous, { epoch: 1, sequence: 99, tick: 99 }), true)
  assert.equal(isRegressedSnapshot(previous, { epoch: 2, sequence: 9, tick: 41 }), true)
  assert.equal(isRegressedSnapshot(previous, { epoch: 2, sequence: 11, tick: 0 }), false)
  assert.equal(isRegressedSnapshot(previous, { epoch: 3, sequence: 0, tick: 0 }), false)
})

test('counts distinct delivered tick changes and rejects every live regression', () => {
  const state = createCommandState()
  assert.deepEqual(observeWorldTick(state, { epoch: 1, tick: 10 }, 0), {
    ok: true,
    advances: 0,
    intervalMs: null,
  })
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 10 }, 50).advances, 0)
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 11 }, 100).intervalMs, 100)
  const skipped = observeWorldTick(state, { epoch: 1, tick: 13 }, 300)
  assert.equal(skipped.advances, 1)
  assert.equal(skipped.intervalMs, 200)
  assert.equal(state.tickAdvances, 2)
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 12 }, 400).ok, false)
  assert.equal(observeWorldTick(state, { epoch: 2, tick: 0 }, 500).ok, false)
  assert.equal(observeWorldTick(state, { epoch: 2, tick: 14 }, 600).intervalMs, 300)
  assert.equal(state.tickAdvances, 3)
})

test('freezes cadence during drain while retaining monotonic validation', () => {
  const state = createCommandState()
  observeWorldTick(state, { epoch: 1, tick: 10 }, 0)
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 11 }, 100).advances, 1)
  state.draining = true
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 12 }, 5_100, !state.draining).advances, 0)
  assert.equal(
    observeWorldTick(state, { epoch: 1, tick: 13 }, 5_200, !state.draining).intervalMs,
    null,
  )
  assert.equal(state.tickAdvances, 1)
  state.pending = { ack: { sequence: 20, tick: 13 } }
  assert.equal(hasAuthoritativePending(state, { sequence: 20, tick: 13 }), true)
  assert.equal(observeWorldTick(state, { epoch: 1, tick: 12 }, 5_300, !state.draining).ok, false)
  assert.equal(tickRateHz(180, 1_000, 21_000), 9)
  assert.equal(tickRateHz(180, 1_000, 26_000), 7.2)
})

test('derives tick and clean-host thresholds from each profile', () => {
  assert.deepEqual(profileNames, ['smoke', '20x4-smoke', '20x4-client-smoke', '5m'])
  assert.equal(playerCountFor(profiles.smoke), 4)
  assert.equal(playerCountFor(profiles['20x4-smoke']), 80)
  assert.equal(playerCountFor(profiles['5m']), 80)
  assert.equal(profiles['20x4-smoke'].driveIntervalMs, 250)
  assert.equal(profiles['5m'].driveIntervalMs, 100)
  assert.equal(minimumTickAdvances(profiles.smoke), 180)
  assert.equal(minimumTickAdvances(profiles['20x4-smoke']), 180)
  assert.equal(minimumTickAdvances(profiles['5m']), 2_700)
  assert.deepEqual(thresholdsFor(profiles.smoke).world_tick_advances_per_vu, ['min>=180'])
  assert.deepEqual(thresholdsFor(profiles['5m']).world_tick_rate_hz, ['min>=9'])
  assert.deepEqual(thresholdsFor(profiles.smoke).world_tick_sampled_vus, ['count==4'])
  assert.deepEqual(thresholdsFor(profiles['5m']).world_tick_sampled_vus, ['count==80'])
  assert.deepEqual(thresholdsFor(profiles.smoke).late_sample_vus, ['count==4'])
  assert.deepEqual(thresholdsFor(profiles['5m']).late_sample_vus, ['count==80'])
  assert.deepEqual(thresholdsFor(profiles.smoke).command_resolution_ratio, ['rate==1'])
  assert.deepEqual(thresholdsFor(profiles.smoke).authoritative_completion_ratio, ['rate>=0.99'])
  assert.deepEqual(thresholdsFor(profiles.smoke).ack_rejections_fatal, ['count==0'])
  assert.deepEqual(thresholdsFor(profiles.smoke).health_active_parties_after_seed, ['value==1'])
  assert.deepEqual(thresholdsFor(profiles['5m']).health_active_parties_after_seed, ['value==20'])
  const smoke = thresholdsFor(profiles.smoke)
  for (const trend of [
    'command_to_frame_ms',
    'full_frame_bytes',
    'world_tick_advances_per_vu',
    'world_tick_rate_hz',
  ]) {
    assert.equal(
      smoke[trend].some((threshold) => threshold.startsWith('count')),
      false,
    )
  }
})

test('applies every short full-shape gate to 20 parties and 80 players', () => {
  assert.deepEqual(profiles['20x4-smoke'], {
    activeMs: 20_000,
    deadline: '35s',
    driveIntervalMs: 250,
    parties: 20,
    playersPerParty: 4,
  })
  assert.deepEqual(profiles['20x4-client-smoke'], {
    activeMs: 20_000,
    deadline: '35s',
    driveIntervalMs: 100,
    parties: 20,
    playersPerParty: 4,
  })
  const fullShape = thresholdsFor(profiles['20x4-smoke'])
  assert.deepEqual(thresholdsFor(profiles['20x4-client-smoke']), fullShape)
  for (const metric of [
    'connections_opened',
    'connections_closed',
    'completed_connections',
    'sampled_connections',
    'late_sample_vus',
    'world_tick_sampled_vus',
  ]) {
    assert.deepEqual(fullShape[metric], ['count==80'])
  }
  assert.deepEqual(fullShape.health_active_parties_before_seed, ['value==0'])
  assert.deepEqual(fullShape.health_active_parties_after_seed, ['value==20'])
  assert.deepEqual(fullShape.world_tick_advances_per_vu, ['min>=180'])
  assert.deepEqual(fullShape.world_tick_rate_hz, ['min>=9'])
  assert.deepEqual(fullShape.command_to_frame_ms, ['p(95)<250'])
  assert.deepEqual(fullShape.full_frame_bytes, ['max<=25000'])
  assert.deepEqual(fullShape.command_resolution_ratio, ['rate==1'])
  assert.deepEqual(fullShape.authoritative_completion_ratio, ['rate>=0.99'])
  assert.deepEqual(fullShape.commands_unresolved, ['count==0'])
  assert.deepEqual(fullShape.ack_rejections_fatal, ['count==0'])
  assert.deepEqual(fullShape.protocol_errors, ['count==0'])
  assert.deepEqual(fullShape.stale_pending_commands, ['count==0'])
  assert.deepEqual(fullShape.oversized_full_frames, ['count==0'])
})

test('parses active party health and reports tick certification evidence', () => {
  assert.equal(activePartiesFromHealth({ activeParties: 0 }), 0)
  assert.equal(activePartiesFromHealth({ activeParties: -1 }), null)
  assert.equal(activePartiesFromHealth({ activeParties: 1.5 }), null)
  const metric = (values) => ({ values })
  const data = {
    metrics: {
      commands_sent: metric({ count: 10 }),
      commands_completed: metric({ count: 8 }),
      commands_resolved: metric({ count: 10 }),
      commands_lifecycle_rejected: metric({ count: 2 }),
      ack_rejections_total: metric({ count: 2 }),
      ack_rejections_lifecycle: metric({ count: 2 }),
      ack_rejections_fatal: metric({ count: 0 }),
      ack_rejection_code_invalid_command: metric({ count: 2 }),
      ack_rejection_reason_party_not_active: metric({ count: 1 }),
      ack_rejection_reason_defeated_player: metric({ count: 1 }),
      world_tick_advances_per_vu: metric({ min: 191, avg: 196 }),
      world_tick_rate_hz: metric({ min: 9.55, avg: 9.8 }),
      world_tick_interval_ms: metric({ 'p(95)': 104 }),
      world_tick_sampled_vus: metric({ count: 4 }),
      world_tick_interval_samples: metric({ count: 784 }),
      health_active_parties_before_seed: metric({ value: 0 }),
      health_active_parties_after_seed: metric({ value: 1 }),
    },
  }
  const summary = buildSummary(data, 'smoke', profiles.smoke, 4)
  assert.equal(summary.worldTickCadenceSemantics, 'distinct-increasing-snapshot')
  assert.equal(summary.resolutionRatio, 1)
  assert.equal(summary.authoritativeSuccessRatio, 0.8)
  assert.equal(summary.ackRejections.byCode['invalid-command'], 2)
  assert.equal(summary.ackRejections.byCode['server-error'], 0)
  assert.equal(summary.ackRejections.byReason['party-not-active'], 1)
  assert.equal(summary.ackRejections.byReason['defeated-player'], 1)
  assert.equal(summary.ackRejections.byReason.other, 0)
  assert.equal(summary.requiredWorldTickAdvancesPerVu, 180)
  assert.equal(summary.worldTickAdvancesMinPerVu, 191)
  assert.equal(summary.worldTickRateHzMin, 9.55)
  assert.equal(summary.worldTickIntervalP95Ms, 104)
  assert.equal(summary.worldTickSampledVus, 4)
  assert.equal(summary.worldTickIntervalSamples, 784)
  assert.equal(summary.healthActivePartiesBeforeSeed, 0)
  assert.equal(summary.healthActivePartiesAfterSeed, 1)
})

test('reports an auditable completion ratio', () => {
  assert.equal(ratio(0, 0), 0)
  assert.equal(ratio(9, 10), 0.9)
  assert.equal(ratio(10, 10), 1)
})
