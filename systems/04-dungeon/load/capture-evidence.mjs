#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { updateGreenEvidenceFromFile } from './evidence.js'

const loadDirectory = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(loadDirectory, 'evidence', 'manifest.json')

function parseArguments(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('arguments must be --name value pairs')
    }
    values[key.slice(2)] = value
  }
  for (const name of ['profile', 'result-file', 'api-image-id', 'web-image-id', 'k6-digest']) {
    if (values[name] === undefined) throw new Error(`missing --${name}`)
  }
  return values
}

function git(args) {
  const result = spawnSync('git', args, { cwd: loadDirectory, encoding: 'utf8', shell: false })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

async function atomicWriteJson(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const [manifestText, resultBytes] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(resolve(args['result-file'])),
  ])
  const manifest = JSON.parse(manifestText)
  const next = updateGreenEvidenceFromFile(manifest, args.profile, resultBytes, {
    timestamp: new Date().toISOString(),
    gitRevision: git(['rev-parse', 'HEAD']),
    gitDirty: git(['status', '--porcelain', '--untracked-files=normal']) !== '',
    apiImageId: args['api-image-id'],
    webImageId: args['web-image-id'],
    k6Digest: args['k6-digest'],
  })
  await atomicWriteJson(manifestPath, next)
  process.stdout.write(`saved green ${args.profile} evidence to ${manifestPath}\n`)
}

const invokedPath =
  process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
