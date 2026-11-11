#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runAudit } from './dx-audit/audit.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '..')

export function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_)
  if (options.help) {
    printHelp()
    return 0
  }

  const result = runAudit(ROOT, options)
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return result.violations.length === 0 ? 0 : 1
  }

  console.log(
    `[dx:audit] baseline ${result.baseline.ref} (${result.baseline.commit.slice(0, 12)}), ${result.changes} changed paths`,
  )
  for (const violation of result.violations) {
    const position = violation.line
      ? `:${violation.line}${violation.column ? `:${violation.column}` : ''}`
      : ''
    console.error(
      `[dx:audit] ${violation.path}${position} [${violation.code}] ${violation.message}`,
    )
  }

  if (result.violations.length > 0) {
    console.error(`[dx:audit] failed with ${result.violations.length} violation(s).`)
    return 1
  }
  console.log(
    `[dx:audit] passed: ${result.systemSources} system TypeScript files and ${result.metrics} drill metric files checked.`,
  )
  return 0
}

function parseArguments(arguments_) {
  const options = { base: undefined, help: false, json: false }
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--json') options.json = true
    else if (argument === '--base') {
      const base = arguments_[++index]
      if (!base) throw new Error('--base needs a Git ref or commit.')
      options.base = base
    } else if (argument.startsWith('--base=')) {
      options.base = argument.slice('--base='.length)
      if (!options.base) throw new Error('--base needs a Git ref or commit.')
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return options
}

function printHelp() {
  console.log(`Usage: node scripts/dx-audit.mjs [options]

Options:
  --base <ref>  Compare changed files with the merge base of this Git ref.
                DX_AUDIT_BASE supplies the same value. GitHub PR base refs are
                detected in CI; local runs compare the worktree with HEAD.
  --json        Print the complete result as JSON.
  -h, --help    Show this help.

Each systems/<id>/dx-metrics.json records:
  schemaVersion, system, drill, wizardLoc, workaroundHelpers, casts,
  explicitGenerics, typecheckMs, and system-relative filesTouched.`)
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`[dx:audit] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
