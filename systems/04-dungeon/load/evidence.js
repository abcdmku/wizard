import { TextDecoder } from 'node:util'
import { playerCountFor, profiles, thresholdsFor } from './k6-config.js'

export const evidenceProfileNames = ['20x4-smoke', '20x4-client-smoke', '5m']
export const officialK6Digest =
  'sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec'
const digestPattern = /^sha256:[0-9a-f]{64}$/u
const revisionPattern = /^[0-9a-f]{40,64}$/u

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function reject(message) {
  throw new Error(`load evidence rejected: ${message}`)
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) reject(`${label} must be ${JSON.stringify(expected)}`)
}

function startsWith(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value)
}

export function decodeResultFile(bytes) {
  if (!(bytes instanceof Uint8Array)) reject('result file must be bytes')
  const unsupported = [
    { prefix: [0x00, 0x00, 0xfe, 0xff], name: 'UTF-32BE' },
    { prefix: [0xff, 0xfe, 0x00, 0x00], name: 'UTF-32LE' },
    { prefix: [0xfe, 0xff], name: 'UTF-16BE' },
    { prefix: [0x2b, 0x2f, 0x76, 0x38], name: 'UTF-7' },
    { prefix: [0x2b, 0x2f, 0x76, 0x39], name: 'UTF-7' },
    { prefix: [0x2b, 0x2f, 0x76, 0x2b], name: 'UTF-7' },
    { prefix: [0x2b, 0x2f, 0x76, 0x2f], name: 'UTF-7' },
    { prefix: [0xf7, 0x64, 0x4c], name: 'UTF-1' },
    { prefix: [0xdd, 0x73, 0x66, 0x73], name: 'UTF-EBCDIC' },
    { prefix: [0x0e, 0xfe, 0xff], name: 'SCSU' },
    { prefix: [0xfb, 0xee, 0x28], name: 'BOCU-1' },
    { prefix: [0x84, 0x31, 0x95, 0x33], name: 'GB18030' },
  ]
  for (const bom of unsupported) {
    if (startsWith(bytes, bom.prefix)) reject(`${bom.name} result files are unsupported`)
  }
  let encoding = 'utf-8'
  let offset = 0
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) offset = 3
  else if (startsWith(bytes, [0xff, 0xfe])) {
    encoding = 'utf-16le'
    offset = 2
    if ((bytes.length - offset) % 2 !== 0) reject('UTF-16LE result file has an odd byte length')
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset))
  } catch {
    reject(`${encoding} result file contains an invalid or truncated sequence`)
  }
}

function profileDefinition(profile) {
  return {
    activeMs: profile.activeMs,
    deadline: profile.deadline,
    driveIntervalMs: profile.driveIntervalMs,
    parties: profile.parties,
    playersPerParty: profile.playersPerParty,
  }
}

function expectedThresholds(profile) {
  return Object.entries(thresholdsFor(profile))
    .flatMap(([metric, thresholds]) =>
      thresholds.map((threshold) => ({ metric, threshold, passed: true })),
    )
    .sort(compareThresholds)
}

function compareThresholds(left, right) {
  return left.metric.localeCompare(right.metric) || left.threshold.localeCompare(right.threshold)
}

function validateThresholds(result, profile) {
  if (!Array.isArray(result.thresholdResults)) reject('thresholdResults must be an array')
  const actual = result.thresholdResults.map((item) => {
    if (!isObject(item) || typeof item.metric !== 'string' || typeof item.threshold !== 'string') {
      reject('thresholdResults contains a malformed entry')
    }
    if (typeof item.passed !== 'boolean') reject('threshold result passed must be boolean')
    return { metric: item.metric, threshold: item.threshold, passed: item.passed }
  })
  actual.sort(compareThresholds)
  const expected = expectedThresholds(profile)
  requireEqual(actual.length, expected.length, 'evaluated threshold count')
  for (let index = 0; index < expected.length; index += 1) {
    requireEqual(actual[index].metric, expected[index].metric, `threshold ${index} metric`)
    requireEqual(actual[index].threshold, expected[index].threshold, `threshold ${index} rule`)
    requireEqual(actual[index].passed, true, `threshold ${actual[index].metric}`)
  }
  requireEqual(result.thresholdsPassed, true, 'thresholdsPassed')
  requireEqual(result.thresholdsEvaluated, expected.length, 'thresholdsEvaluated')
  requireEqual(result.thresholdsFailed, 0, 'thresholdsFailed')
  if (!Array.isArray(result.failedThresholds) || result.failedThresholds.length !== 0) {
    reject('failedThresholds must be empty')
  }
  return { evaluated: expected.length, passed: expected.length, failed: 0, results: actual }
}

export function extractLoadResult(text) {
  const marker = 'DUNGEON_LOAD_RESULT '
  const matches = String(text)
    .split(/\r?\n/u)
    .filter((line) => line.includes(marker))
    .map((line) => line.slice(line.indexOf(marker) + marker.length).trim())
  if (matches.length !== 1) reject('input must contain exactly one DUNGEON_LOAD_RESULT line')
  let result
  try {
    result = JSON.parse(matches[0])
  } catch {
    reject('DUNGEON_LOAD_RESULT is not valid JSON')
  }
  if (!isObject(result)) reject('DUNGEON_LOAD_RESULT must be an object')
  return result
}

export function parseLoadResultFile(bytes) {
  return extractLoadResult(decodeResultFile(bytes))
}

export function validateEvidenceManifest(manifest) {
  if (!isObject(manifest) || manifest.schemaVersion !== 1)
    reject('manifest schemaVersion must be 1')
  if (!isObject(manifest.k6) || manifest.k6.image !== 'grafana/k6') {
    reject('manifest k6 image must be grafana/k6')
  }
  if (manifest.k6.digest !== officialK6Digest) reject('manifest k6 digest is not the official pin')
  if (!isObject(manifest.profiles) || !isObject(manifest.greenRuns)) {
    reject('manifest profiles and greenRuns must be objects')
  }
  for (const name of evidenceProfileNames) {
    const expected = profileDefinition(profiles[name])
    const actual = manifest.profiles[name]
    if (!isObject(actual)) reject(`manifest profile ${name} is missing`)
    for (const [key, value] of Object.entries(expected)) {
      requireEqual(actual[key], value, `manifest profile ${name}.${key}`)
    }
  }
  return manifest
}

function validateMetadata(metadata) {
  if (!isObject(metadata)) reject('capture metadata must be an object')
  const timestamp = new Date(metadata.timestamp)
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== metadata.timestamp) {
    reject('timestamp must be an ISO-8601 UTC instant')
  }
  if (!revisionPattern.test(metadata.gitRevision)) reject('git revision must be a full object ID')
  if (typeof metadata.gitDirty !== 'boolean') reject('gitDirty must be boolean')
  if (!digestPattern.test(metadata.apiImageId)) reject('API image ID must be exact SHA-256')
  if (!digestPattern.test(metadata.webImageId)) reject('web image ID must be exact SHA-256')
  if (metadata.k6Digest !== officialK6Digest) reject('k6 digest does not match the official pin')
}

export function updateGreenEvidence(manifest, profileName, result, metadata) {
  validateEvidenceManifest(manifest)
  if (!evidenceProfileNames.includes(profileName)) reject(`unsupported profile ${profileName}`)
  const profile = profiles[profileName]
  const players = playerCountFor(profile)
  if (!isObject(result)) reject('DUNGEON_LOAD_RESULT must be an object')
  requireEqual(result.profile, profileName, 'result profile')
  requireEqual(result.activeMs, profile.activeMs, 'result activeMs')
  requireEqual(result.deadline, profile.deadline, 'result deadline')
  requireEqual(result.driveIntervalMs, profile.driveIntervalMs, 'result driveIntervalMs')
  requireEqual(result.parties, profile.parties, 'result parties')
  requireEqual(result.players, players, 'result players')
  requireEqual(result.healthActivePartiesBeforeSeed, 0, 'clean-health precondition')
  requireEqual(result.healthActivePartiesAfterSeed, profile.parties, 'seeded party count')
  requireEqual(result.resolutionRatio, 1, 'resolutionRatio')
  if (
    typeof result.authoritativeSuccessRatio !== 'number' ||
    result.authoritativeSuccessRatio < 0.99
  ) {
    reject('authoritativeSuccessRatio must be at least 0.99')
  }
  requireEqual(result.lateAuthoritativeSnapshotVus, players, 'late snapshot VU count')
  const thresholds = validateThresholds(result, profile)
  validateMetadata(metadata)
  const entry = {
    capturedAt: metadata.timestamp,
    git: { revision: metadata.gitRevision, dirty: metadata.gitDirty },
    images: { apiId: metadata.apiImageId, webId: metadata.webImageId },
    k6: { ...manifest.k6 },
    cleanHealthPrecondition: { requiredActiveParties: 0, observedActiveParties: 0 },
    profile: profileName,
    thresholds: { ...thresholds, failures: [] },
    dungeonLoadResult: result,
  }
  return { ...manifest, greenRuns: { ...manifest.greenRuns, [profileName]: entry } }
}

export function updateGreenEvidenceFromFile(manifest, profileName, bytes, metadata) {
  return updateGreenEvidence(manifest, profileName, parseLoadResultFile(bytes), metadata)
}
