import { readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const systemRoot = resolve(import.meta.dirname, '..')
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const excludedDirectories = new Set([
  '.pulumi',
  'coverage',
  'dist',
  'migrations',
  'node_modules',
  'playwright-report',
  'test-results',
])

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name) ? [] : sourceFiles(path)
      }
      return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [path] : []
    }),
  )
  return nested.flat()
}

function syntaxKindFor(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function unsafeSyntax(path, source) {
  const failures = []
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, syntaxKindFor(path))
  const visit = (node) => {
    if (ts.isNonNullExpression(node)) {
      failures.push(
        `non-null assertion at ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
      )
    }
    if (ts.isAsExpression(node)) {
      const typeText = node.type.getText(file).replaceAll(/\s/g, '')
      if (typeText === 'any') {
        failures.push(`as any at ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
      }
      if (typeText === 'unknown') {
        failures.push(
          `as unknown at ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return failures
}

function validateMetrics(value, existingPaths) {
  const failures = []
  if (value.schemaVersion !== 1) failures.push('schemaVersion must be 1')
  if (value.system !== '03-fulfillment') failures.push('system must be 03-fulfillment')
  if (value.drill !== 'fraud-review') failures.push('drill must be fraud-review')
  for (const key of [
    'wizardLoc',
    'workaroundHelpers',
    'casts',
    'explicitGenerics',
    'typecheckMs',
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < 0) failures.push(`${key} must be nonnegative`)
  }
  if (!Array.isArray(value.filesTouched) || value.filesTouched.length < 1) {
    failures.push('filesTouched must contain 1 to 6 paths')
  } else {
    if (value.filesTouched.length > 6) failures.push('filesTouched exceeds the six-file DX limit')
    if (new Set(value.filesTouched).size !== value.filesTouched.length) {
      failures.push('filesTouched paths must be unique')
    }
    for (const path of value.filesTouched) {
      if (typeof path !== 'string' || !existingPaths.has(path.replaceAll('\\', '/'))) {
        failures.push(`filesTouched path does not exist: ${String(path)}`)
      }
    }
  }
  return failures
}

const files = await sourceFiles(systemRoot)
const existingPaths = new Set(files.map((path) => relative(systemRoot, path).replaceAll('\\', '/')))
const failures = []
for (const path of files) {
  const source = await readFile(path, 'utf8')
  const displayPath = relative(systemRoot, path).replaceAll('\\', '/')
  const lines = source === '' ? 0 : source.replace(/\n$/, '').split(/\r?\n/).length
  if (lines > 300) failures.push(`${displayPath}: ${lines} lines exceeds 300`)
  for (const failure of unsafeSyntax(path, source)) failures.push(`${displayPath}: ${failure}`)
}

try {
  const rawMetrics = await readFile(resolve(systemRoot, 'dx-metrics.json'), 'utf8')
  const metrics = JSON.parse(rawMetrics)
  failures.push(
    ...validateMetrics(metrics, existingPaths).map((failure) => `dx-metrics.json: ${failure}`),
  )
} catch (error) {
  failures.push(`dx-metrics.json: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`DX audit passed for ${files.length} handwritten source and test files.`)
}
