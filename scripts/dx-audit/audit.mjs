import { resolve } from 'node:path'

import { isProductionPath, isSystemPath, isTypeScriptPath, MAX_LINES } from './config.mjs'
import { listFiles, readHandwrittenFile } from './files.mjs'
import { collectChanges, determineBaseline } from './git.mjs'
import { validateMetrics } from './metrics.mjs'
import { inspectSystemSources } from './source-checks.mjs'

export function runAudit(root, options = {}) {
  const baseline = determineBaseline(root, { base: options.base })
  const changes = collectChanges(root, baseline.commit)
  const systemPaths = listFiles(root, 'systems')
  const candidatePaths = new Set(systemPaths)
  for (const change of changes.values()) candidatePaths.add(change.path)

  const handwrittenFiles = new Map()
  for (const path of candidatePaths) {
    const file = readHandwrittenFile(root, path)
    if (file) handwrittenFiles.set(file.path, file)
  }

  const violations = checkFileSizes(handwrittenFiles, changes)
  const systemSources = [...handwrittenFiles.values()].filter(
    (file) => isSystemPath(file.path) && isTypeScriptPath(file.path),
  )
  violations.push(...inspectSystemSources(systemSources))

  const metricResult = validateMetrics(root)
  violations.push(...metricResult.violations)
  violations.sort(compareViolations)

  return {
    baseline,
    changes: changes.size,
    metrics: metricResult.validMetrics,
    root: resolve(root),
    systemSources: systemSources.length,
    violations,
  }
}

export function checkFileSizes(files, changes) {
  const violations = []
  for (const file of files.values()) {
    if (file.lines <= MAX_LINES) continue
    const change = changes.get(file.path)
    const mustCheck =
      isSystemPath(file.path) ||
      change?.status === 'A' ||
      (change !== undefined && isProductionPath(file.path))
    if (!mustCheck) continue

    let reason = 'System source/test file'
    if (change?.status === 'A') reason = 'New handwritten source/test file'
    else if (change) reason = 'Touched production file'
    violations.push({
      code: 'max-lines',
      line: MAX_LINES + 1,
      message: `${reason} has ${file.lines} lines; the limit is ${MAX_LINES}.`,
      path: file.path,
    })
  }
  return violations
}

function compareViolations(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.code.localeCompare(right.code)
  )
}
