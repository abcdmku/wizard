import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  integrationResources,
  shellAssignments as integrationShellAssignments,
} from './integration-resources.mjs'
import {
  applyDungeonUrlDefaults,
  loadDungeonEnv,
  parseDotEnv,
  shellAssignments,
} from './load-env.mjs'

test('parseDotEnv handles comments, export prefixes, quotes, and inline comments', () => {
  const values = parseDotEnv(`\uFEFF
    # ignored
    export DUNGEON_API_PORT=4499
    DUNGEON_SEED_KEY="key with spaces" # trailing comment
    DUNGEON_HASHED="quoted # secret"
    DUNGEON_JWT_SECRET='quoted#secret'
    DUNGEON_EMPTY=
  `)

  assert.deepEqual(Object.fromEntries(values), {
    DUNGEON_API_PORT: '4499',
    DUNGEON_SEED_KEY: 'key with spaces',
    DUNGEON_HASHED: 'quoted # secret',
    DUNGEON_JWT_SECRET: 'quoted#secret',
    DUNGEON_EMPTY: '',
  })
})

test('loadDungeonEnv reads a selected file without overwriting inherited values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dungeon-env-'))
  const filePath = path.join(directory, '.env')
  try {
    await writeFile(filePath, 'DUNGEON_API_PORT=4499\nDUNGEON_SEED_KEY=file-key\n')
    const target = { DUNGEON_SEED_KEY: 'shell-key' }
    const result = loadDungeonEnv(target, { filePath })
    assert.deepEqual(result.loadedKeys, ['DUNGEON_API_PORT'])
    assert.deepEqual(target, { DUNGEON_API_PORT: '4499', DUNGEON_SEED_KEY: 'shell-key' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('shellAssignments safely quotes values and preserves inherited values', () => {
  const values = new Map([
    ['DUNGEON_SEED_KEY', "it's-local"],
    ['DUNGEON_API_PORT', '4499'],
  ])
  assert.equal(
    shellAssignments(values, { DUNGEON_API_PORT: '4410' }),
    `export DUNGEON_SEED_KEY='it'"'"'s-local'`,
  )
})

test('applyDungeonUrlDefaults follows custom ports without replacing explicit URLs', () => {
  const target = {
    DUNGEON_API_PORT: '4499',
    DUNGEON_WEB_PORT: '4490',
    DUNGEON_WS_URL: 'ws://localhost:4410/ws',
    DUNGEON_WEB_URL: 'https://browser.example.test',
  }
  applyDungeonUrlDefaults(target)
  assert.deepEqual(target, {
    DUNGEON_API_PORT: '4499',
    DUNGEON_WEB_PORT: '4490',
    DUNGEON_API_URL: 'http://127.0.0.1:4499',
    DUNGEON_WS_URL: 'ws://127.0.0.1:4499/ws',
    DUNGEON_WEB_URL: 'https://browser.example.test',
  })
})

test('browser WebSocket build defaults stay on the page origin', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const [envExample, compose, dockerfile] = await Promise.all([
    readFile(path.join(root, '.env.example'), 'utf8'),
    readFile(path.join(root, 'compose.yaml'), 'utf8'),
    readFile(path.join(root, 'web', 'Dockerfile'), 'utf8'),
  ])
  assert.equal(parseDotEnv(envExample).get('DUNGEON_BROWSER_WS_URL'), '/ws')
  assert.match(compose, /VITE_WS_URL: \$\{DUNGEON_BROWSER_WS_URL:-\/ws\}/u)
  assert.match(dockerfile, /ARG VITE_WS_URL=\/ws/u)
})

test('integration resources cannot target custom main .env resources', () => {
  const mainEnv = Object.fromEntries(
    parseDotEnv(`DUNGEON_DB_VOLUME=custom-main-volume\nDUNGEON_NETWORK_NAME=custom-main-network\n`),
  )
  const resources = integrationResources({ ...mainEnv, DUNGEON_INTEGRATION_RUN_ID: 'test-123' })

  assert.deepEqual(resources, {
    project: 'openwizard-dungeon-integration-test-123',
    volume: 'openwizard-dungeon-integration-test-123',
    network: 'openwizard-dungeon-integration-test-123',
  })
  assert.notEqual(resources.volume, mainEnv.DUNGEON_DB_VOLUME)
  assert.notEqual(resources.network, mainEnv.DUNGEON_NETWORK_NAME)
  assert.match(
    integrationShellAssignments(resources),
    /export DUNGEON_DB_VOLUME='openwizard-dungeon-integration-test-123'/u,
  )
})

test('integration overrides reject the main resource names', () => {
  assert.throws(
    () =>
      integrationResources({
        DUNGEON_DB_VOLUME: 'custom-main-volume',
        DUNGEON_INTEGRATION_DB_VOLUME: 'custom-main-volume',
      }),
    /cannot be the main Dungeon Postgres volume/u,
  )
  assert.throws(
    () =>
      integrationResources({
        DUNGEON_NETWORK_NAME: 'custom-main-network',
        DUNGEON_INTEGRATION_NETWORK_NAME: 'custom-main-network',
      }),
    /cannot be the main Dungeon network/u,
  )
})

test('kept integration stacks document scoped cleanup', async () => {
  const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
  const integrationScript = await readFile(path.join(scriptsRoot, 'integration.sh'), 'utf8')
  const readme = await readFile(path.join(scriptsRoot, '..', 'README.md'), 'utf8')
  const troubleshooting = await readFile(
    path.join(scriptsRoot, '..', 'docs', 'troubleshooting.md'),
    'utf8',
  )

  assert.match(integrationScript, /integration-resources\.mjs --shell/u)
  assert.match(integrationScript, /docker compose -p "\$DUNGEON_INTEGRATION_PROJECT"/u)
  assert.match(integrationScript, /pnpm reset:integration/u)
  assert.match(readme, /DUNGEON_INTEGRATION_PROJECT=.*pnpm reset:integration/su)
  assert.match(troubleshooting, /DUNGEON_INTEGRATION_PROJECT=.*pnpm reset:integration/su)
  assert.doesNotMatch(
    `${readme}\n${troubleshooting}`,
    /DUNGEON_KEEP_STACK=1[\s\S]{0,240}pnpm reset(?!:integration)/u,
  )
})
