#!/usr/bin/env node

import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'tests/integration/websocket.integration.test.ts',
  'tests/integration/postgres-restart.integration.test.ts',
]

for (const relative of required) {
  try {
    await access(path.join(systemRoot, relative))
  } catch {
    throw new Error(`Required integration test is missing: ${relative}`)
  }
}

console.log(`Integration test gate passed: ${required.length} files present.`)
