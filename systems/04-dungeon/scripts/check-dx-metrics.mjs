#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const metricsPath = path.join(root, 'dx-metrics.json')
const metrics = JSON.parse(await readFile(metricsPath, 'utf8'))

const required = [
  'schemaVersion',
  'system',
  'drill',
  'wizardLoc',
  'workaroundHelpers',
  'casts',
  'explicitGenerics',
  'typecheckMs',
  'filesTouched',
]
for (const key of required) {
  if (!(key in metrics)) throw new Error(`dx-metrics.json is missing ${key}`)
}
if (metrics.schemaVersion !== 1 || metrics.system !== '04-dungeon') {
  throw new Error('dx-metrics.json has the wrong schema or system')
}
if (metrics.drill !== 'player-bound-key') {
  throw new Error('dx-metrics.json must record the player-bound-key drill')
}
for (const key of ['wizardLoc', 'workaroundHelpers', 'casts', 'explicitGenerics', 'typecheckMs']) {
  if (!Number.isFinite(metrics[key]) || metrics[key] < 0) {
    throw new Error(`${key} must be a non-negative number`)
  }
}
if (
  !Array.isArray(metrics.filesTouched) ||
  metrics.filesTouched.length < 1 ||
  metrics.filesTouched.length > 6
) {
  throw new Error('filesTouched must contain one through six paths')
}
if (new Set(metrics.filesTouched).size !== metrics.filesTouched.length) {
  throw new Error('filesTouched must contain unique paths')
}

for (const relative of metrics.filesTouched) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('..')) {
    throw new Error(`filesTouched path is not system-relative: ${relative}`)
  }
  if (/(^|[\\/])(node_modules|dist|coverage|public[\\/]assets)([\\/]|$)/u.test(relative)) {
    throw new Error(`generated path is not allowed in filesTouched: ${relative}`)
  }
  try {
    await readFile(path.join(root, relative))
  } catch {
    throw new Error(`filesTouched path does not exist: ${relative}`)
  }
}

console.log(
  `DX metrics valid: ${metrics.filesTouched.length} files, ${metrics.typecheckMs} ms typecheck`,
)
