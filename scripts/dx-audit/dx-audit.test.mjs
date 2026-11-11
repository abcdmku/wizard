import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkFileSizes } from './audit.mjs'
import { isHandwrittenSourcePath, isProductionPath } from './config.mjs'
import { countLines } from './files.mjs'
import { collectChanges, determineBaseline, parseNameStatus } from './git.mjs'
import { validateMetrics } from './metrics.mjs'
import { inspectSystemSources, inspectTypeScriptSource } from './source-checks.mjs'

test('source path classification excludes generated artifacts and migrations', () => {
  assert.equal(isHandwrittenSourcePath('systems/01-intake/src/app.ts'), true)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/src/app.test.ts'), true)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/generated/client.ts'), false)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/src/app.generated.ts'), false)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/migrations/0001.ts'), false)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/drizzle/0001_init.sql'), false)
  assert.equal(isProductionPath('systems/01-intake/src/app.test.ts'), false)
  assert.equal(isProductionPath('packages/core/tests/api.test-d.ts'), false)
  assert.equal(isProductionPath('systems/01-intake/src/app.ts'), true)
})

test('generated API snapshots do not exempt handwritten declarations', () => {
  assert.equal(isHandwrittenSourcePath('api/core.d.ts'), false)
  assert.equal(isHandwrittenSourcePath('api/core-testing.d.ts'), false)
  assert.equal(isHandwrittenSourcePath('packages/example/src/public.d.ts'), true)
  assert.equal(isHandwrittenSourcePath('systems/01-intake/api/public.d.ts'), true)

  const path = 'packages/example/src/public.d.ts'
  const violations = checkFileSizes(
    new Map([[path, { path, lines: 401 }]]),
    new Map([[path, { path, status: 'A' }]]),
  )
  assert.deepEqual(
    violations.map((violation) => violation.path),
    [path],
  )
})

test('line counting handles LF, CRLF, and a missing final newline', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('one\n'), 1)
  assert.equal(countLines('one\r\ntwo\r\n'), 2)
  assert.equal(countLines('one\ntwo'), 2)
})

test('size checks distinguish new tests from untouched legacy tests', () => {
  const files = new Map([
    ['new.test.ts', { path: 'new.test.ts', lines: 401 }],
    ['legacy.test.ts', { path: 'legacy.test.ts', lines: 450 }],
    ['src/legacy.ts', { path: 'src/legacy.ts', lines: 450 }],
  ])
  const changes = new Map([
    ['new.test.ts', { path: 'new.test.ts', status: 'A' }],
    ['src/legacy.ts', { path: 'src/legacy.ts', status: 'M' }],
  ])
  const violations = checkFileSizes(files, changes)
  assert.deepEqual(
    violations.map((violation) => violation.path),
    ['new.test.ts', 'src/legacy.ts'],
  )
})

test('system assertions are checked with an explicit unknown escape hatch', () => {
  const source = `
const first = value as any
const second = value as unknown
// dx-audit: as-unknown -- third-party declaration is missing this field
const third = value as unknown
const fourth = value!
class Example { field!: string }
`
  const codes = inspectTypeScriptSource('systems/01-intake/src/example.ts', source).violations.map(
    (violation) => violation.code,
  )
  assert.deepEqual(codes, [
    'no-as-any',
    'unexplained-as-unknown',
    'no-non-null',
    'no-definite-assignment',
  ])
})

test('schema-shadowing types and repeated DTO shapes are reported', () => {
  const violations = inspectSystemSources([
    {
      path: 'systems/01-intake/src/schema.ts',
      content: `
const ApplicantSchema = z.object({ id: z.string(), amount: z.number() })
const StatusSchema = z.object({ state: z.string() })
export interface Applicant { id: string; amount: number }
export interface Status { code: string; label: string }
export interface GrantRequest { id: string; amount: number }
`,
    },
    {
      path: 'systems/01-intake/src/api.ts',
      content: 'export type GrantResponse = { amount: number; id: string }',
    },
  ])
  assert.deepEqual(violations.map((violation) => violation.code).sort(), [
    'manual-schema-type',
    'repeated-domain-type',
  ])
})

test('metric validation accepts the documented schema', (context) => {
  const root = temporaryDirectory(context)
  const systemDirectory = join(root, 'systems', '01-intake')
  mkdirSync(join(systemDirectory, 'src'), { recursive: true })
  writeFileSync(join(systemDirectory, 'src', 'wizard.ts'), 'export {}\n')
  writeFileSync(
    join(systemDirectory, 'dx-metrics.json'),
    JSON.stringify({
      schemaVersion: 1,
      system: '01-intake',
      drill: 'beneficial-owner',
      wizardLoc: 42,
      workaroundHelpers: 0,
      casts: 0,
      explicitGenerics: 1,
      typecheckMs: 800,
      filesTouched: ['src/wizard.ts'],
    }),
  )
  const result = validateMetrics(root, { '01-intake': 'beneficial-owner' })
  assert.equal(result.validMetrics, 1)
  assert.deepEqual(result.violations, [])
})

test('metric validation rejects a drill over six handwritten files', (context) => {
  const root = temporaryDirectory(context)
  const systemDirectory = join(root, 'systems', '04-dungeon')
  mkdirSync(join(systemDirectory, 'src'), { recursive: true })
  const filesTouched = []
  for (let index = 0; index < 7; index++) {
    const path = `src/change-${index}.ts`
    writeFileSync(join(systemDirectory, path), 'export {}\n')
    filesTouched.push(path)
  }
  writeFileSync(
    join(systemDirectory, 'dx-metrics.json'),
    JSON.stringify({
      schemaVersion: 1,
      system: '04-dungeon',
      drill: 'player-bound-key',
      wizardLoc: 100,
      workaroundHelpers: 1,
      casts: 1,
      explicitGenerics: 2,
      typecheckMs: 1000,
      filesTouched,
    }),
  )
  const result = validateMetrics(root, { '04-dungeon': 'player-bound-key' })
  assert.equal(
    result.violations.some((violation) => violation.code === 'too-many-drill-files'),
    true,
  )
})

test('Git name-status parsing handles renames', () => {
  const changes = parseNameStatus('M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0')
  assert.deepEqual(changes.get('src/a.ts'), { path: 'src/a.ts', status: 'M' })
  assert.deepEqual(changes.get('src/new.ts'), {
    path: 'src/new.ts',
    previousPath: 'src/old.ts',
    status: 'R',
  })
})

test('Git collection includes tracked worktree edits and untracked files', (context) => {
  const root = temporaryDirectory(context)
  git(root, 'init')
  git(root, 'config', 'user.email', 'dx-audit@example.test')
  git(root, 'config', 'user.name', 'DX Audit')
  writeFileSync(join(root, 'tracked.ts'), 'export const value = 1\n')
  git(root, 'add', 'tracked.ts')
  git(root, 'commit', '-m', 'fixture')
  const baseline = determineBaseline(root, { base: 'HEAD', environment: {} })

  writeFileSync(join(root, 'tracked.ts'), 'export const value = 2\n')
  writeFileSync(join(root, 'untracked.ts'), 'export {}\n')
  const changes = collectChanges(root, baseline.commit)
  assert.equal(changes.get('tracked.ts')?.status, 'M')
  assert.equal(changes.get('untracked.ts')?.status, 'A')
})

test('local baseline stays at HEAD even when an upstream is stale', (context) => {
  const root = temporaryDirectory(context)
  git(root, 'init')
  git(root, 'config', 'user.email', 'dx-audit@example.test')
  git(root, 'config', 'user.name', 'DX Audit')
  writeFileSync(join(root, 'tracked.ts'), 'export const value = 1\n')
  git(root, 'add', 'tracked.ts')
  git(root, 'commit', '-m', 'old upstream')
  git(root, 'branch', 'stale-upstream')
  writeFileSync(join(root, 'tracked.ts'), 'export const value = 2\n')
  git(root, 'commit', '-am', 'current head')
  git(root, 'branch', '--set-upstream-to=stale-upstream')

  const head = gitOutput(root, 'rev-parse', 'HEAD')
  const baseline = determineBaseline(root, { environment: {} })
  assert.equal(baseline.commit, head)
  assert.equal(baseline.ref, 'HEAD')
})

test('GitHub pull request baseline uses the merge base', (context) => {
  const root = temporaryDirectory(context)
  git(root, 'init')
  git(root, 'config', 'user.email', 'dx-audit@example.test')
  git(root, 'config', 'user.name', 'DX Audit')
  writeFileSync(join(root, 'tracked.ts'), 'export const value = 1\n')
  git(root, 'add', 'tracked.ts')
  git(root, 'commit', '-m', 'pull request base')
  git(root, 'branch', 'pull-request-base')
  const expected = gitOutput(root, 'rev-parse', 'HEAD')
  writeFileSync(join(root, 'tracked.ts'), 'export const value = 2\n')
  git(root, 'commit', '-am', 'pull request head')

  const baseline = determineBaseline(root, {
    environment: { GITHUB_BASE_REF: 'pull-request-base' },
  })
  assert.equal(baseline.commit, expected)
  assert.equal(baseline.ref, 'pull-request-base')
})

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), 'openwizard-dx-audit-'))
  context.after(() => {
    if (directory.startsWith(tmpdir())) rmSync(directory, { force: true, recursive: true })
  })
  return directory
}

function git(root, ...arguments_) {
  execFileSync('git', arguments_, { cwd: root, stdio: 'ignore' })
}

function gitOutput(root, ...arguments_) {
  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim()
}
