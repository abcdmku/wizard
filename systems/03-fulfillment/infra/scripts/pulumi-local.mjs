import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const infraDirectory = resolve(scriptDirectory, '..')
const lambdaDirectory = resolve(infraDirectory, '..', 'lambdas')
const stateDirectory = resolve(infraDirectory, '.pulumi')
const action = process.argv[2] ?? 'preview'
const actionArguments = {
  preview: ['preview', '--stack', 'local'],
  up: ['up', '--refresh', '--yes', '--stack', 'local'],
  destroy: ['destroy', '--yes', '--stack', 'local'],
  outputs: ['stack', 'output', '--json', '--stack', 'local'],
}[action]

if (actionArguments === undefined) {
  throw new Error(`Unsupported action: ${action}`)
}

const backendUrl = localBackendUrl()

const environment = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
  CONFIG_STRATEGY: process.env.CONFIG_STRATEGY ?? 'overwrite',
  PULUMI_BACKEND_URL: backendUrl,
  PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? 'fulfillment-local-only',
  PULUMI_SKIP_UPDATE_CHECK: 'true',
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const pulumiLocalCommand = process.platform === 'win32' ? 'pulumilocal.exe' : 'pulumilocal'

if (action !== 'outputs') {
  run(pnpmCommand, ['--dir', lambdaDirectory, 'build'], infraDirectory, environment)
}

run(
  pulumiLocalCommand,
  ['stack', 'select', 'local', '--create', '--non-interactive'],
  infraDirectory,
  environment,
)
run(pulumiLocalCommand, [...actionArguments, '--non-interactive'], infraDirectory, environment)

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) {
    throw new Error(`Could not run ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function localBackendUrl() {
  const configuredUrl = process.env.PULUMI_BACKEND_URL
  if (configuredUrl === undefined) {
    mkdirSync(stateDirectory, { recursive: true })
    return pathToFileURL(stateDirectory).href
  }

  const parsedUrl = new URL(configuredUrl)
  if (parsedUrl.protocol !== 'file:') {
    throw new Error('Fulfillment infrastructure requires a file:// Pulumi backend')
  }
  mkdirSync(fileURLToPath(parsedUrl), { recursive: true })
  return parsedUrl.href
}
