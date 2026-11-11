#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { applyDungeonUrlDefaults, loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()
applyDungeonUrlDefaults()

const [command, ...args] = process.argv.slice(2)
if (command === undefined) throw new Error('Usage: node scripts/with-env.mjs <command> [args...]')
const windowsCmdNames = new Set(['playwright', 'pnpm', 'vitest'])
const executable =
  process.platform !== 'win32'
    ? command
    : command === 'node'
      ? process.execPath
      : windowsCmdNames.has(command)
        ? `${command}.cmd`
        : command

const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: executable.endsWith('.cmd'),
  stdio: 'inherit',
})

child.once('error', (error) => {
  throw error
})
child.once('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
