#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { integrationResources } from './integration-resources.mjs'
import { loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = process.env.DUNGEON_COMPOSE_FILE ?? 'compose.yaml'
const resources = integrationResources()
const environment = {
  ...process.env,
  DUNGEON_DB_VOLUME: resources.volume,
  DUNGEON_NETWORK_NAME: resources.network,
}

const result = spawnSync(
  'docker',
  ['compose', '-p', resources.project, '-f', composeFile, 'down', '--volumes', '--remove-orphans'],
  { cwd: systemRoot, env: environment, shell: false, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Dungeon integration project ${resources.project} and its resources were removed.`)
