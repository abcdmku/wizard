#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = process.env.DUNGEON_COMPOSE_FILE ?? 'compose.yaml'

const result = spawnSync(
  'docker',
  ['compose', '-f', composeFile, 'down', '--volumes', '--remove-orphans'],
  { cwd: systemRoot, stdio: 'inherit', shell: false },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('Dungeon containers and the Dungeon Postgres volume were removed.')
