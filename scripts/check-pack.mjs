#!/usr/bin/env node
/**
 * Validate the files and entrypoints that npm would publish for every
 * non-private package in packages/*.
 *
 * This is deliberately driven by the package manifests rather than a fixed
 * package list. It requires a build first, then asks npm for its dry-run
 * manifest and verifies that all package entrypoint targets are included.
 * It also loads the built @openwizard/core entries (ESM and CJS) and checks
 * that its subpaths share the main entry's runtime.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const npmCommand = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
const npmArgs =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts']
    : ['pack', '--dry-run', '--json', '--ignore-scripts']

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(PACKAGES_DIR, entry.name))
  .filter((dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true
    } catch {
      return false
    }
  })

if (packages.length === 0) {
  console.error('[check:pack] no non-private packages found under packages/*')
  process.exit(1)
}

let failures = 0

for (const dir of packages) {
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const label = manifest.name ?? relative(ROOT, dir)
  const result = spawnSync(npmCommand, npmArgs, { cwd: dir, encoding: 'utf8' })

  if (result.error || result.status !== 0) {
    failures++
    console.error(`[check:pack] ${label}: npm pack failed`)
    if (result.error) console.error(`  ${result.error.message}`)
    if (result.stderr?.trim()) console.error(result.stderr.trim())
    continue
  }

  let packed
  try {
    packed = parsePackJson(result.stdout)
  } catch (error) {
    failures++
    console.error(`[check:pack] ${label}: npm pack returned invalid JSON`)
    console.error(`  ${error.message}`)
    continue
  }

  const files = new Set(
    (packed.files ?? []).map((file) => normalizePath(file.path)).filter(Boolean),
  )
  const problems = []

  if (packed.name !== manifest.name) {
    problems.push(`packed name ${JSON.stringify(packed.name)} !== ${JSON.stringify(manifest.name)}`)
  }
  if (packed.version !== manifest.version) {
    problems.push(
      `packed version ${JSON.stringify(packed.version)} !== ${JSON.stringify(manifest.version)}`,
    )
  }
  if (!files.has('package.json')) problems.push('package.json is missing from the tarball')

  const targets = []
  const targetProblems = []
  collectTargets(manifest.exports, 'exports', targets, targetProblems)
  for (const field of ['main', 'module', 'types', 'typings', 'browser']) {
    if (typeof manifest[field] === 'string')
      collectTarget(manifest[field], field, targets, targetProblems)
  }
  problems.push(...targetProblems)

  for (const target of targets) {
    if (!matchesTarget(target.value, files)) {
      problems.push(
        `${target.label} points to ${JSON.stringify(`./${target.value}`)}, which is not packed`,
      )
    }
  }

  if (problems.length > 0) {
    failures++
    console.error(`[check:pack] ${label}: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  - ${problem}`)
    continue
  }

  console.log(
    `[check:pack] ${label}@${manifest.version}: ${files.size} files, ${targets.length} entrypoint targets`,
  )
}

const runtimeProblems = await checkCoreSharedRuntime()
runtimeProblems.push(...checkCoreTypeCompatibility())
for (const problem of runtimeProblems) console.error(`[check:pack] @openwizard/core: ${problem}`)

if (failures > 0 || runtimeProblems.length > 0) {
  console.error(`[check:pack] ${failures} package(s) failed`)
  process.exit(1)
}

console.log(`[check:pack] ${packages.length} publishable package(s) validated`)

/**
 * The built entries of @openwizard/core must share one runtime: a subpath that bundles its own
 * copy of the compiler rejects `boundary.trusted()` contexts made by the main entry (private
 * checker symbol) and throws errors that fail `instanceof WizardError`.
 */
async function checkCoreSharedRuntime() {
  const dist = join(PACKAGES_DIR, 'core', 'dist')
  const require = createRequire(import.meta.url)
  const loaders = {
    esm: (entry) => import(pathToFileURL(join(dist, `${entry}.js`)).href),
    cjs: async (entry) => require(join(dist, `${entry}.cjs`)),
  }
  const problems = []
  for (const [format, load] of Object.entries(loaders)) {
    const core = await load('index')
    const { inspect } = await load('inspect')
    const mirror = await load('mirror')
    const probe = core.defineWizard(
      { name: 'shared-runtime-probe', context: core.boundary.trusted() },
      ({ view, steps }) => steps({ form: view({ input: core.boundary.trusted() }) }),
    )
    try {
      inspect(probe)
    } catch (error) {
      problems.push(`${format}: /inspect rejects a flow built with the main entry (${error})`)
    }
    try {
      inspect({})
      problems.push(`${format}: /inspect accepted an invalid flow`)
    } catch (error) {
      if (!(error instanceof core.WizardError))
        problems.push(`${format}: errors thrown by /inspect are not the main entry's WizardError`)
    }
    const run = probe.provide({}).create({})
    try {
      const projection = core.defineProjection(probe, { expose: { context: [] } })
      const source = mirror.createMirrorSource(run, projection)
      const frame = source.getFrame()
      if (frame.kind !== 'snapshot' || frame.state.status !== 'idle')
        problems.push(`${format}: /mirror cannot project a run from the main entry`)
      source.dispose()
    } catch (error) {
      problems.push(`${format}: /mirror rejects a run from the main entry (${error})`)
    } finally {
      run.dispose()
    }
  }
  return problems
}

/** Published subpaths must reuse core's nominal types in both module formats. */
function checkCoreTypeCompatibility() {
  const ts = createRequire(import.meta.url)('typescript')
  const code = `
    import { boundary, defineProjection, defineWizard } from '@openwizard/core'
    import { createMirror, createMirrorSource } from '@openwizard/core/mirror'
    const wizard = defineWizard(
      { name: 'published-types', context: boundary.trusted<{ count: number }>() },
      ({ step, steps }) => steps({ work: step({ run: ({ context }) => context.count + 1 }) }),
    )
    const projection = defineProjection(wizard, { expose: { output: true } })
    const run = wizard.provide({}).create({ count: 1 })
    createMirrorSource(run, projection)
    const mirror = createMirror<typeof projection>({})
    mirror.startStep('work')
    // @ts-expect-error published declarations must reject unknown step ids
    mirror.startStep('missing')
  `
  const problems = []
  for (const format of ['mts', 'cts']) {
    const probePath = join(PACKAGES_DIR, 'core', `__openwizard_pack_probe__.${format}`)
    const options = {
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host)
    const fileExists = host.fileExists.bind(host)
    host.readFile = (file) => (resolve(file) === probePath ? code : readFile(file))
    host.fileExists = (file) => resolve(file) === probePath || fileExists(file)
    const program = ts.createProgram({ rootNames: [probePath], options, host })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length > 0) {
      const details = diagnostics
        .slice(0, 5)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
        .join('; ')
      problems.push(`${format}: published main/mirror types are incompatible: ${details}`)
    }
  }
  return problems
}

function parsePackJson(output) {
  const trimmed = output.trim()
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed[0] : parsed
  } catch {
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start < 0 || end <= start) throw new Error('no JSON array in npm output')
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed[0] : parsed
  }
}

function collectTargets(value, label, targets, problems) {
  if (value == null) return
  if (typeof value === 'string') {
    collectTarget(value, label, targets, problems)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectTargets(item, `${label}[${index}]`, targets, problems)
    })
    return
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectTargets(item, `${label}.${key}`, targets, problems)
    }
  }
}

function collectTarget(value, label, targets, problems) {
  if (!value.startsWith('./')) {
    problems.push(`${label} must use a relative package target, got ${JSON.stringify(value)}`)
    return
  }
  const target = normalizePath(value.slice(2))
  if (!target || target.startsWith('../') || target.includes('/../') || target.startsWith('/')) {
    problems.push(`${label} escapes the package directory: ${JSON.stringify(value)}`)
    return
  }
  targets.push({ label, value: target })
}

function matchesTarget(target, files) {
  if (!target.includes('*')) return files.has(target)
  const firstStar = target.indexOf('*')
  const lastStar = target.lastIndexOf('*')
  if (firstStar !== lastStar) return false
  const prefix = target.slice(0, firstStar)
  const suffix = target.slice(firstStar + 1)
  return [...files].some(
    (file) =>
      file.startsWith(prefix) &&
      file.endsWith(suffix) &&
      file.length >= prefix.length + suffix.length,
  )
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}
