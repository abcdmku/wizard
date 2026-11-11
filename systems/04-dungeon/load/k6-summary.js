import { ACK_CODE_KEYS, ACK_REASON_KEYS, metricKey } from './ack-policy.js'
import { minimumTickAdvances } from './k6-config.js'
import { ratio } from './state-machine.js'

function metricValue(data, metric, field) {
  const value = data.metrics[metric]?.values?.[field]
  return typeof value === 'number' ? value : 0
}

function counterDistribution(data, keys, prefix) {
  return Object.fromEntries(
    keys.map((key) => [key, metricValue(data, `${prefix}_${metricKey(key)}`, 'count')]),
  )
}

function thresholdEvidence(data) {
  const failed = []
  const results = []
  for (const metric of Object.keys(data.metrics ?? {}).sort()) {
    const thresholds = data.metrics[metric]?.thresholds
    if (thresholds === null || typeof thresholds !== 'object') continue
    for (const threshold of Object.keys(thresholds).sort()) {
      const ok = thresholds[threshold]?.ok
      if (typeof ok !== 'boolean') continue
      results.push({ metric, threshold, passed: ok })
      if (!ok) failed.push({ metric, threshold })
    }
  }
  return { evaluated: results.length, failed, results }
}

export function buildSummary(data, profileName, profile, playerCount) {
  const sent = metricValue(data, 'commands_sent', 'count')
  const completed = metricValue(data, 'commands_completed', 'count')
  const resolved = metricValue(data, 'commands_resolved', 'count')
  const p95 = metricValue(data, 'command_to_frame_ms', 'p(95)')
  const maxBytes = metricValue(data, 'full_frame_bytes', 'max')
  const thresholdResults = thresholdEvidence(data)
  return {
    profile: profileName,
    parties: profile.parties,
    players: playerCount,
    activeMs: profile.activeMs,
    deadline: profile.deadline,
    driveIntervalMs: profile.driveIntervalMs,
    worldTickCadenceSemantics: 'distinct-increasing-snapshot',
    requiredWorldTickAdvancesPerVu: minimumTickAdvances(profile),
    requiredWorldTickRateHz: 9,
    requiredAuthoritativeSuccessRatio: 0.99,
    commandToFrameP95Ms: p95,
    commandsSent: sent,
    achievedCommandsPerSecond: metricValue(data, 'commands_sent', 'rate'),
    commandsCompleted: completed,
    commandsResolved: resolved,
    commandsLifecycleRejected: metricValue(data, 'commands_lifecycle_rejected', 'count'),
    commandsUnresolved: metricValue(data, 'commands_unresolved', 'count'),
    resolutionRatio: ratio(resolved, sent),
    completionRatio: ratio(completed, sent),
    authoritativeSuccessRatio: ratio(completed, sent),
    ackRejections: {
      total: metricValue(data, 'ack_rejections_total', 'count'),
      lifecycle: metricValue(data, 'ack_rejections_lifecycle', 'count'),
      fatal: metricValue(data, 'ack_rejections_fatal', 'count'),
      byCode: counterDistribution(data, ACK_CODE_KEYS, 'ack_rejection_code'),
      byReason: counterDistribution(data, ACK_REASON_KEYS, 'ack_rejection_reason'),
    },
    connectionsOpened: metricValue(data, 'connections_opened', 'count'),
    connectionsClosed: metricValue(data, 'connections_closed', 'count'),
    completedConnections: metricValue(data, 'completed_connections', 'count'),
    authoritativeCommandSampledConnections: metricValue(data, 'sampled_connections', 'count'),
    earlyConnectionCloses: metricValue(data, 'early_connection_closes', 'count'),
    authoritativeCommandFrames: metricValue(data, 'authoritative_command_frames', 'count'),
    lastAuthoritativeSnapshotOffsetMsMin: metricValue(
      data,
      'last_authoritative_snapshot_offset_ms',
      'min',
    ),
    lastAuthoritativeSnapshotOffsetMsMax: metricValue(
      data,
      'last_authoritative_snapshot_offset_ms',
      'max',
    ),
    activeDurationMsMin: metricValue(data, 'connection_active_duration_ms', 'min'),
    worldTickAdvancesMinPerVu: metricValue(data, 'world_tick_advances_per_vu', 'min'),
    worldTickAdvancesAveragePerVu: metricValue(data, 'world_tick_advances_per_vu', 'avg'),
    worldTickRateHzMin: metricValue(data, 'world_tick_rate_hz', 'min'),
    worldTickRateHzAverage: metricValue(data, 'world_tick_rate_hz', 'avg'),
    worldTickIntervalP95Ms: metricValue(data, 'world_tick_interval_ms', 'p(95)'),
    worldTickSampledVus: metricValue(data, 'world_tick_sampled_vus', 'count'),
    worldTickIntervalSamples: metricValue(data, 'world_tick_interval_samples', 'count'),
    healthActivePartiesBeforeSeed: metricValue(data, 'health_active_parties_before_seed', 'value'),
    healthActivePartiesAfterSeed: metricValue(data, 'health_active_parties_after_seed', 'value'),
    fullFrameCount: metricValue(data, 'full_frame_count', 'count'),
    fullFrameBytesTotal: metricValue(data, 'full_frame_bytes_total', 'count'),
    fullFrameBytesMax: maxBytes,
    oversizedFullFrames: metricValue(data, 'oversized_full_frames', 'count'),
    protocolErrors: metricValue(data, 'protocol_errors', 'count'),
    stalePendingCommands: metricValue(data, 'stale_pending_commands', 'count'),
    lateAuthoritativeSnapshotVus: metricValue(data, 'late_sample_vus', 'count'),
    thresholdsPassed: thresholdResults.evaluated > 0 && thresholdResults.failed.length === 0,
    thresholdsEvaluated: thresholdResults.evaluated,
    thresholdsFailed: thresholdResults.failed.length,
    failedThresholds: thresholdResults.failed,
    thresholdResults: thresholdResults.results,
    triggers: {
      latencyP95AtLeast250Ms: p95 >= 250,
      fullFrameOver25000Bytes: maxBytes > 25_000,
    },
  }
}
