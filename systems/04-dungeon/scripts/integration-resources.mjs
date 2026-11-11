#!/usr/bin/env node

const resourceName = /^[a-z0-9][a-z0-9_.-]*$/iu

const assertResourceName = (name, label) => {
  if (!resourceName.test(name)) {
    throw new Error(`${label} must be a Docker-safe resource name: ${name}`)
  }
  return name
}

export const integrationResources = (target = process.env) => {
  const runId = target.DUNGEON_INTEGRATION_RUN_ID ?? target.DUNGEON_RUN_ID ?? String(process.pid)
  const generatedName = `openwizard-dungeon-integration-${runId}`
  const project = assertResourceName(
    target.DUNGEON_INTEGRATION_PROJECT ?? generatedName,
    'DUNGEON_INTEGRATION_PROJECT',
  )
  const volume = assertResourceName(
    target.DUNGEON_INTEGRATION_DB_VOLUME ?? generatedName,
    'DUNGEON_INTEGRATION_DB_VOLUME',
  )
  const network = assertResourceName(
    target.DUNGEON_INTEGRATION_NETWORK_NAME ?? generatedName,
    'DUNGEON_INTEGRATION_NETWORK_NAME',
  )
  const mainProject = 'openwizard-dungeon'
  const mainVolume = target.DUNGEON_DB_VOLUME ?? 'openwizard-dungeon-postgres'
  const mainNetwork = target.DUNGEON_NETWORK_NAME ?? mainProject

  if (project === mainProject) {
    throw new Error('DUNGEON_INTEGRATION_PROJECT cannot be the main Dungeon Compose project')
  }
  if (volume === mainVolume) {
    throw new Error('DUNGEON_INTEGRATION_DB_VOLUME cannot be the main Dungeon Postgres volume')
  }
  if (network === mainNetwork) {
    throw new Error('DUNGEON_INTEGRATION_NETWORK_NAME cannot be the main Dungeon network')
  }

  return { project, volume, network }
}

const shellQuote = (value) => `'${value.replaceAll("'", `"'"'`)}'`

export const shellAssignments = (resources) =>
  [
    ['DUNGEON_INTEGRATION_PROJECT', resources.project],
    ['DUNGEON_DB_VOLUME', resources.volume],
    ['DUNGEON_NETWORK_NAME', resources.network],
  ]
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n')

if (process.argv[1]?.endsWith('integration-resources.mjs')) {
  const resources = integrationResources()
  if (process.argv.includes('--shell')) process.stdout.write(`${shellAssignments(resources)}\n`)
}
