import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceProfileNames,
  extractLoadResult,
  officialK6Digest,
  updateGreenEvidence,
  updateGreenEvidenceFromFile,
} from './evidence.js'
import { profiles, thresholdsFor } from './k6-config.js'
import { buildSummary } from './k6-summary.js'
import { createCommandState, observeAuthoritativeSnapshot } from './state-machine.js'

const metric = (values, thresholds) => ({ values, thresholds })

test('separates authoritative completion from resolution and reports exact counts', () => {
  const data = {
    metrics: {
      commands_sent: metric({ count: 10, rate: 0.5 }, { 'count>0': { ok: true } }),
      commands_completed: metric({ count: 8 }, { 'count>0': { ok: true } }),
      commands_resolved: metric({ count: 10 }),
      authoritative_command_frames: metric({ count: 8 }),
      sampled_connections: metric({ count: 4 }),
      late_sample_vus: metric({ count: 4 }),
      last_authoritative_snapshot_offset_ms: metric({ min: 19_000, max: 19_900 }),
      early_connection_closes: metric({ count: 0 }),
      oversized_full_frames: metric({ count: 1 }, { 'count==0': { ok: false } }),
    },
  }
  const summary = buildSummary(data, 'smoke', profiles.smoke, 4)
  assert.equal(summary.completionRatio, 0.8)
  assert.equal(summary.resolutionRatio, 1)
  assert.equal(summary.authoritativeSuccessRatio, 0.8)
  assert.equal(summary.requiredAuthoritativeSuccessRatio, 0.99)
  assert.equal(summary.achievedCommandsPerSecond, 0.5)
  assert.equal(summary.deadline, '35s')
  assert.equal(summary.driveIntervalMs, 250)
  assert.equal(summary.authoritativeCommandFrames, 8)
  assert.equal(summary.authoritativeCommandSampledConnections, 4)
  assert.equal(summary.lateAuthoritativeSnapshotVus, 4)
  assert.equal(summary.lastAuthoritativeSnapshotOffsetMsMin, 19_000)
  assert.equal(summary.earlyConnectionCloses, 0)
  assert.equal(summary.oversizedFullFrames, 1)
  assert.equal(summary.thresholdsPassed, false)
  assert.equal(summary.thresholdsEvaluated, 3)
  assert.equal(summary.thresholdsFailed, 1)
  assert.deepEqual(summary.failedThresholds, [
    { metric: 'oversized_full_frames', threshold: 'count==0' },
  ])
  assert.deepEqual(summary.thresholdResults, [
    { metric: 'commands_completed', threshold: 'count>0', passed: true },
    { metric: 'commands_sent', threshold: 'count>0', passed: true },
    { metric: 'oversized_full_frames', threshold: 'count==0', passed: false },
  ])
})

test('does not claim a threshold pass without k6 threshold results', () => {
  const summary = buildSummary({ metrics: {} }, 'smoke', profiles.smoke, 4)
  assert.equal(summary.thresholdsPassed, false)
  assert.equal(summary.thresholdsEvaluated, 0)
  assert.equal(summary.thresholdsFailed, 0)
  assert.deepEqual(summary.failedThresholds, [])
})

const snapshot = (sequence, tick) => ({
  epoch: 1,
  sequence,
  tick,
  projection: { phase: 'exploration', self: { status: 'downed', health: 0 } },
})

const snapshotState = () => ({
  ...createCommandState(),
  openedAt: 1_000,
  lastSnapshotCursor: null,
  lastAuthoritativeSnapshotAt: 0,
  lateSnapshotRecorded: false,
  closed: false,
})

test('counts the first strictly newer valid snapshot at 95 percent once', () => {
  const state = snapshotState()
  assert.equal(
    observeAuthoritativeSnapshot(state, snapshot(1, 1), 19_980, 20_000).lateSnapshot,
    false,
  )
  assert.equal(state.selfStatus, 'downed')
  assert.equal(state.selfHealth, 0)
  assert.equal(
    observeAuthoritativeSnapshot(state, snapshot(2, 2), 20_000, 20_000).lateSnapshot,
    true,
  )
  assert.equal(
    observeAuthoritativeSnapshot(state, snapshot(2, 2), 20_100, 20_000).lateSnapshot,
    false,
  )
  assert.equal(state.lastAuthoritativeSnapshotAt, 20_000)
})

test('rejects malformed, regressed, draining, closed, and stalled late evidence', () => {
  const malformed = snapshotState()
  assert.equal(observeAuthoritativeSnapshot(malformed, { epoch: 1 }, 20_000, 20_000).ok, false)
  const regressed = snapshotState()
  observeAuthoritativeSnapshot(regressed, snapshot(2, 2), 2_000, 20_000)
  assert.equal(observeAuthoritativeSnapshot(regressed, snapshot(1, 3), 20_000, 20_000).ok, false)
  const draining = snapshotState()
  draining.draining = true
  assert.equal(
    observeAuthoritativeSnapshot(draining, snapshot(1, 1), 20_000, 20_000).lateSnapshot,
    false,
  )
  const closed = snapshotState()
  closed.closed = true
  assert.equal(
    observeAuthoritativeSnapshot(closed, snapshot(1, 1), 20_000, 20_000).lateSnapshot,
    false,
  )
  const stalled = snapshotState()
  observeAuthoritativeSnapshot(stalled, snapshot(1, 1), 19_980, 20_000)
  assert.equal(stalled.lateSnapshotRecorded, false)
})

const exactId = `sha256:${'a'.repeat(64)}`
const evidenceManifest = () => ({
  schemaVersion: 1,
  k6: { image: 'grafana/k6', digest: officialK6Digest },
  profiles: Object.fromEntries(
    evidenceProfileNames.map((name) => {
      const { activeMs, deadline, driveIntervalMs, parties, playersPerParty } = profiles[name]
      return [name, { activeMs, deadline, driveIntervalMs, parties, playersPerParty }]
    }),
  ),
  greenRuns: {},
})

function greenResult(profileName = '20x4-smoke') {
  const profile = profiles[profileName]
  const thresholdResults = Object.entries(thresholdsFor(profile)).flatMap(([metricName, rules]) =>
    rules.map((threshold) => ({ metric: metricName, threshold, passed: true })),
  )
  return {
    profile: profileName,
    activeMs: profile.activeMs,
    deadline: profile.deadline,
    driveIntervalMs: profile.driveIntervalMs,
    parties: profile.parties,
    players: profile.parties * profile.playersPerParty,
    healthActivePartiesBeforeSeed: 0,
    healthActivePartiesAfterSeed: profile.parties,
    resolutionRatio: 1,
    authoritativeSuccessRatio: 0.995,
    lateAuthoritativeSnapshotVus: profile.parties * profile.playersPerParty,
    thresholdsPassed: true,
    thresholdsEvaluated: thresholdResults.length,
    thresholdsFailed: 0,
    failedThresholds: [],
    thresholdResults,
  }
}

const evidenceMetadata = {
  timestamp: '2026-08-23T20:00:00.000Z',
  gitRevision: '1'.repeat(40),
  gitDirty: true,
  apiImageId: exactId,
  webImageId: exactId,
  k6Digest: officialK6Digest,
}

test('builds canonical green evidence for every supported profile', () => {
  let manifest = evidenceManifest()
  for (const profileName of evidenceProfileNames) {
    const result = greenResult(profileName)
    manifest = updateGreenEvidence(manifest, profileName, result, evidenceMetadata)
    const saved = manifest.greenRuns[profileName]
    assert.equal(saved.dungeonLoadResult, result)
    assert.equal(saved.thresholds.evaluated, result.thresholdsEvaluated)
    assert.equal(saved.thresholds.passed, result.thresholdsEvaluated)
    assert.equal(saved.thresholds.failed, 0)
    assert.equal(saved.git.dirty, true)
    assert.equal(saved.images.apiId, exactId)
    assert.equal(saved.k6.digest, officialK6Digest)
    assert.deepEqual(saved.cleanHealthPrecondition, {
      requiredActiveParties: 0,
      observedActiveParties: 0,
    })
  }
})

test('red, malformed, missing-threshold, and deadline-drift input cannot replace green', () => {
  const accepted = updateGreenEvidence(
    evidenceManifest(),
    '20x4-smoke',
    greenResult(),
    evidenceMetadata,
  )
  const before = JSON.stringify(accepted)
  const red = greenResult()
  red.thresholdResults[0].passed = false
  assert.throws(() => updateGreenEvidence(accepted, '20x4-smoke', red, evidenceMetadata))
  const missing = greenResult()
  missing.thresholdResults.pop()
  missing.thresholdsEvaluated -= 1
  assert.throws(() => updateGreenEvidence(accepted, '20x4-smoke', missing, evidenceMetadata))
  const deadlineDrift = greenResult()
  deadlineDrift.deadline = '36s'
  assert.throws(
    () => updateGreenEvidence(accepted, '20x4-smoke', deadlineDrift, evidenceMetadata),
    /result deadline/u,
  )
  const manifestDrift = evidenceManifest()
  manifestDrift.profiles['20x4-smoke'].deadline = '36s'
  assert.throws(
    () => updateGreenEvidence(manifestDrift, '20x4-smoke', greenResult(), evidenceMetadata),
    /manifest profile 20x4-smoke.deadline/u,
  )
  assert.throws(() => extractLoadResult('DUNGEON_LOAD_RESULT {broken'))
  assert.throws(() => extractLoadResult('no result marker'))
  assert.equal(JSON.stringify(accepted), before)
})

test('extracts one exact result and rejects an unpinned runner', () => {
  const result = greenResult()
  assert.deepEqual(
    extractLoadResult(`noise\nDUNGEON_LOAD_RESULT ${JSON.stringify(result)}\n`),
    result,
  )
  assert.throws(() =>
    updateGreenEvidence(evidenceManifest(), '20x4-smoke', result, {
      ...evidenceMetadata,
      k6Digest: `sha256:${'b'.repeat(64)}`,
    }),
  )
  const repinned = evidenceManifest()
  repinned.k6.digest = `sha256:${'b'.repeat(64)}`
  assert.throws(
    () =>
      updateGreenEvidence(repinned, '20x4-smoke', result, {
        ...evidenceMetadata,
        k6Digest: repinned.k6.digest,
      }),
    /official pin/u,
  )
})

const encodedResult = () => `DUNGEON_LOAD_RESULT ${JSON.stringify(greenResult())}\r\n`

test('captures UTF-8, UTF-8 BOM, and BOM-marked UTF-16LE result files', () => {
  const utf8 = Buffer.from(encodedResult(), 'utf8')
  const fixtures = [
    utf8,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(encodedResult(), 'utf16le')]),
  ]
  for (const bytes of fixtures) {
    const updated = updateGreenEvidenceFromFile(
      evidenceManifest(),
      '20x4-smoke',
      bytes,
      evidenceMetadata,
    )
    assert.equal(updated.greenRuns['20x4-smoke'].dungeonLoadResult.profile, '20x4-smoke')
  }
})

test('encoding failures cannot replace preserved green evidence', () => {
  const accepted = updateGreenEvidence(
    evidenceManifest(),
    '20x4-smoke',
    greenResult(),
    evidenceMetadata,
  )
  const before = JSON.stringify(accepted)
  const invalidFiles = [
    Buffer.from([0xfe, 0xff, 0x00, 0x41]),
    Buffer.from([0xff, 0xfe, 0x00, 0x00]),
    Buffer.from([0x2b, 0x2f, 0x76, 0x38]),
    Buffer.from([0xff, 0xfe, 0x41]),
    Buffer.from([0xef, 0xbb]),
    Buffer.from([0xc3, 0x28]),
    Buffer.from([0xff, 0xfe, 0x00, 0xd8]),
    Buffer.from('DUNGEON_LOAD_RESULT {broken', 'utf8'),
    Buffer.from(`${encodedResult()}${encodedResult()}`, 'utf8'),
  ]
  for (const bytes of invalidFiles) {
    assert.throws(() =>
      updateGreenEvidenceFromFile(accepted, '20x4-smoke', bytes, evidenceMetadata),
    )
    assert.equal(JSON.stringify(accepted), before)
  }
})
