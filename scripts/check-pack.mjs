#!/usr/bin/env node
/**
 * Validate the files and entrypoints that npm would publish for every
 * non-private package in packages/*.
 *
 * This is deliberately driven by the package manifests rather than a fixed
 * package list. It requires a build first, then asks npm for its dry-run
 * manifest and verifies that all package entrypoint targets are included.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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

if (failures > 0) {
  console.error(`[check:pack] ${failures} package(s) failed`)
  process.exit(1)
}

console.log(`[check:pack] ${packages.length} publishable package(s) validated`)

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
