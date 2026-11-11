import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { normalizePath, SYSTEMS } from './config.mjs'
import { readHandwrittenFile } from './files.mjs'

const NONNEGATIVE_METRICS = ['casts', 'explicitGenerics', 'workaroundHelpers']
const POSITIVE_METRICS = ['typecheckMs', 'wizardLoc']

export function validateMetrics(root, systems = SYSTEMS) {
  const violations = []
  let validMetrics = 0

  for (const [system, drill] of Object.entries(systems)) {
    const systemDirectory = resolve(root, 'systems', system)
    const displayPath = `systems/${system}/dx-metrics.json`
    if (!existsSync(systemDirectory)) {
      violations.push(metricViolation(displayPath, 'missing-system', `Missing systems/${system}.`))
      continue
    }

    const metricsPath = resolve(systemDirectory, 'dx-metrics.json')
    if (!existsSync(metricsPath)) {
      violations.push(
        metricViolation(displayPath, 'missing-metrics', 'Missing change-drill metrics.'),
      )
      continue
    }

    let metrics
    try {
      metrics = JSON.parse(readFileSync(metricsPath, 'utf8').replace(/^\uFEFF/, ''))
    } catch (error) {
      violations.push(
        metricViolation(displayPath, 'invalid-metrics-json', `Cannot parse JSON: ${error.message}`),
      )
      continue
    }

    const before = violations.length
    validateMetricObject(metrics, {
      displayPath,
      drill,
      root,
      system,
      systemDirectory,
      violations,
    })
    if (violations.length === before) validMetrics++
  }
  return { validMetrics, violations }
}

function validateMetricObject(metrics, context) {
  const { displayPath, drill, system, violations } = context
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    violations.push(metricViolation(displayPath, 'invalid-metrics', 'Metrics must be an object.'))
    return
  }

  expectEqual(metrics, 'schemaVersion', 1, context)
  expectEqual(metrics, 'system', system, context)
  expectEqual(metrics, 'drill', drill, context)
  for (const name of NONNEGATIVE_METRICS) expectInteger(metrics, name, 0, context)
  for (const name of POSITIVE_METRICS) expectInteger(metrics, name, 1, context)
  validateTouchedFiles(metrics.filesTouched, context)
}

function validateTouchedFiles(files, context) {
  const { displayPath, root, systemDirectory, violations } = context
  if (!Array.isArray(files) || files.length === 0) {
    violations.push(
      metricViolation(
        displayPath,
        'invalid-files-touched',
        'filesTouched must be a non-empty array.',
      ),
    )
    return
  }

  const seen = new Set()
  let handwrittenCount = 0
  for (const value of files) {
    if (typeof value !== 'string' || value.length === 0) {
      violations.push(
        metricViolation(
          displayPath,
          'invalid-touched-path',
          'Every touched path must be a string.',
        ),
      )
      continue
    }
    if (value.includes('\\')) {
      violations.push(
        metricViolation(displayPath, 'invalid-touched-path', `${value}: use forward slashes.`),
      )
      continue
    }
    const path = normalizePath(value)
    if (seen.has(path)) {
      violations.push(
        metricViolation(displayPath, 'duplicate-touched-path', `${path}: listed more than once.`),
      )
      continue
    }
    seen.add(path)

    const absolutePath = resolve(systemDirectory, path)
    const escaped = relative(systemDirectory, absolutePath)
    if (isAbsolute(path) || escaped === '..' || escaped.startsWith(`..${separator()}`)) {
      violations.push(
        metricViolation(
          displayPath,
          'invalid-touched-path',
          `${path}: must stay inside the system.`,
        ),
      )
      continue
    }
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      violations.push(
        metricViolation(displayPath, 'missing-touched-file', `${path}: file does not exist.`),
      )
      continue
    }
    const repositoryPath = normalizePath(relative(root, absolutePath))
    if (readHandwrittenFile(root, repositoryPath)) handwrittenCount++
  }

  if (handwrittenCount > 6) {
    violations.push(
      metricViolation(
        displayPath,
        'too-many-drill-files',
        `Change drill lists ${handwrittenCount} handwritten files; the limit is 6.`,
      ),
    )
  }
}

function expectEqual(metrics, name, expected, context) {
  if (metrics[name] === expected) return
  context.violations.push(
    metricViolation(
      context.displayPath,
      'invalid-metric-field',
      `${name} must equal ${JSON.stringify(expected)}.`,
    ),
  )
}

function expectInteger(metrics, name, minimum, context) {
  if (Number.isInteger(metrics[name]) && metrics[name] >= minimum) return
  context.violations.push(
    metricViolation(
      context.displayPath,
      'invalid-metric-field',
      `${name} must be an integer greater than or equal to ${minimum}.`,
    ),
  )
}

function metricViolation(path, code, message) {
  return { code, message, path }
}

function separator() {
  return process.platform === 'win32' ? '\\' : '/'
}
