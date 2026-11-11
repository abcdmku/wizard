import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const filename = resolve(root, 'dx-metrics.json')
const metrics = JSON.parse(await readFile(filename, 'utf8'))
const numeric = ['wizardLoc', 'workaroundHelpers', 'casts', 'explicitGenerics', 'typecheckMs']

if (
  metrics.schemaVersion !== 1 ||
  metrics.system !== '02-fleet' ||
  metrics.drill !== 'cold-chain'
) {
  throw new Error('dx-metrics.json must identify schema 1, system 02-fleet, and cold-chain')
}
for (const key of numeric) {
  if (typeof metrics[key] !== 'number' || metrics[key] < 0) throw new Error(`${key} must be >= 0`)
}
if (
  !Array.isArray(metrics.filesTouched) ||
  metrics.filesTouched.length < 1 ||
  metrics.filesTouched.length > 6
) {
  throw new Error('filesTouched must contain one to six paths')
}
if (new Set(metrics.filesTouched).size !== metrics.filesTouched.length)
  throw new Error('filesTouched must be unique')
for (const entry of metrics.filesTouched) {
  if (typeof entry !== 'string' || entry.includes('..')) throw new Error(`invalid path: ${entry}`)
  const path = resolve(root, entry)
  if (!path.startsWith(root)) throw new Error(`path escapes system root: ${entry}`)
  try {
    await readFile(path)
  } catch {
    throw new Error(`filesTouched path does not exist: ${relative(root, path)}`)
  }
}
console.log(`DX metrics valid (${metrics.filesTouched.length} touched paths)`)
