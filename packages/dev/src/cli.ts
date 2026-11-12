#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startDevServer } from './server/server'

const USAGE = `Usage: openwizard dev [entry] [--port 4400] [--host 127.0.0.1] [--no-watch]

Starts a local server and a browser UI for the wizards the entry file exports.
Without an entry it looks for openwizard.dev.ts, .mts, .js or .mjs in this folder.`

const DEFAULTS = [
  'openwizard.dev.ts',
  'openwizard.dev.mts',
  'openwizard.dev.js',
  'openwizard.dev.mjs',
]

function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (command !== 'dev') fail(`Unknown command: ${command}`)

  let entry: string | undefined
  let port: number | undefined
  let host: string | undefined
  let watch = true
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] as string
    if (arg === '--port') port = Number(rest[++index])
    else if (arg === '--host') host = rest[++index]
    else if (arg === '--no-watch') watch = false
    else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`)
    else entry = arg
  }
  if (port !== undefined && !Number.isInteger(port)) fail('--port takes a number.')
  entry ??= DEFAULTS.find((name) => existsSync(resolve(name)))
  if (entry === undefined) fail('No entry file. Pass one, or create openwizard.dev.ts.')
  if (!existsSync(resolve(entry))) fail(`No file at ${resolve(entry)}.`)

  const server = await startDevServer({
    entry,
    watch,
    ...(port === undefined ? {} : { port }),
    ...(host === undefined ? {} : { host }),
  }).catch((error: NodeJS.ErrnoException) =>
    fail(
      error.code === 'EADDRINUSE'
        ? `Port ${port ?? 4400} is in use. Pass --port with another one.`
        : error.message,
    ),
  )
  process.stdout.write(`\n  OpenWizard dev  ${server.url}\n  entry           ${resolve(entry)}\n\n`)
  const stop = () => void server.close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

void main()
