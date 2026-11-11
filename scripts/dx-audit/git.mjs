import { execFileSync } from 'node:child_process'

import { normalizePath } from './config.mjs'

const MAX_GIT_OUTPUT = 64 * 1024 * 1024

export function determineBaseline(root, options = {}) {
  const environment = options.environment ?? process.env
  const requested = options.base ?? environment.DX_AUDIT_BASE
  if (requested) return baselineFromRef(root, requested, true)

  if (environment.GITHUB_BASE_REF) {
    for (const candidate of [
      `origin/${environment.GITHUB_BASE_REF}`,
      environment.GITHUB_BASE_REF,
    ]) {
      const baseline = baselineFromRef(root, candidate, false)
      if (baseline) return baseline
    }
    throw new Error(`Cannot resolve GitHub base ref '${environment.GITHUB_BASE_REF}'.`)
  }

  // A local audit is about the current worktree. An upstream can lag behind HEAD
  // and make old branch history look newly touched, so do not select it here.
  return baselineFromRef(root, 'HEAD', true)
}

export function collectChanges(root, baselineCommit) {
  const diff = runGit(
    root,
    ['diff', '--no-ext-diff', '--find-renames', '--name-status', '-z', baselineCommit, '--'],
    true,
  )
  const changes = parseNameStatus(diff.stdout)

  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'], true)
  for (const path of splitNull(untracked.stdout)) {
    const normalized = normalizePath(path)
    if (!changes.has(normalized)) {
      changes.set(normalized, { path: normalized, status: 'A' })
    }
  }
  return changes
}

export function parseNameStatus(output) {
  const tokens = splitNull(output)
  const changes = new Map()
  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index++]
    const status = rawStatus[0]
    if (!status) continue

    if (status === 'R' || status === 'C') {
      const previousPath = normalizePath(tokens[index++] ?? '')
      const path = normalizePath(tokens[index++] ?? '')
      if (path) changes.set(path, { path, previousPath, status })
      continue
    }

    const path = normalizePath(tokens[index++] ?? '')
    if (path) changes.set(path, { path, status })
  }
  return changes
}

function baselineFromRef(root, ref, required) {
  const verified = runGit(root, ['rev-parse', '--verify', `${ref}^{commit}`])
  if (!verified.ok) {
    if (required) throw new Error(`Cannot resolve Git baseline '${ref}'.`)
    return undefined
  }

  const mergeBase = runGit(root, ['merge-base', 'HEAD', verified.stdout.trim()])
  if (!mergeBase.ok) {
    if (required) throw new Error(`Cannot find a merge base for '${ref}'.`)
    return undefined
  }
  return { commit: mergeBase.stdout.trim(), ref }
}

function runGit(root, arguments_, required = false) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', arguments_, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (error) {
    if (required) {
      const detail = error.stderr?.toString().trim()
      throw new Error(detail || `git ${arguments_.join(' ')} failed`, { cause: error })
    }
    return { ok: false, stdout: '' }
  }
}

function splitNull(output) {
  const tokens = output.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  return tokens
}
