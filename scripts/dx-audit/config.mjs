import { extname } from 'node:path'

// Matches the file-size contract in docs/design/architecture-plan.md.
export const MAX_LINES = 400

export const SYSTEMS = Object.freeze({
  '01-intake': 'beneficial-owner',
  '02-fleet': 'cold-chain',
  '03-fulfillment': 'fraud-review',
  '04-dungeon': 'player-bound-key',
})

const HANDWRITTEN_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.graphql',
  '.gql',
  '.js',
  '.jsx',
  '.less',
  '.mjs',
  '.mts',
  '.sass',
  '.scss',
  '.sql',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
])

const TYPESCRIPT_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx'])

const BINARY_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.psd',
  '.tif',
  '.tiff',
  '.webp',
])

const IGNORED_DIRECTORY_PATTERN =
  /(^|\/)(?:\.git|\.next|\.nuxt|\.output|\.pulumi|\.svelte-kit|\.turbo|coverage|dist|build|node_modules|out|vendor)(?:\/|$)/
const GENERATED_DIRECTORY_PATTERN =
  /(^|\/)(?:__generated__|generated|generated-client|generated-clients)(?:\/|$)/
const GENERATED_API_SNAPSHOT_PATTERN = /^api\/[^/]+\.d\.ts$/
const MIGRATION_PATTERN = /(^|\/)(?:migration|migrations)(?:\/|$)/
const TEST_PATH_PATTERN =
  /(^|\/)(?:__fixtures__|__tests__|e2e|fixtures|integration-tests?|test|tests)(?:\/|$)/
const TEST_FILE_PATTERN =
  /\.(?:contract|e2e|integration|spec|test|type-test|types-test)(?:-d)?\.[^.]+$/

export function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

export function isSystemPath(path) {
  return normalizePath(path).startsWith('systems/')
}

export function isTypeScriptPath(path) {
  return TYPESCRIPT_EXTENSIONS.has(extname(normalizePath(path)).toLowerCase())
}

export function isHandwrittenSourcePath(path) {
  const normalized = normalizePath(path)
  const extension = extname(normalized).toLowerCase()
  if (!HANDWRITTEN_EXTENSIONS.has(extension)) return false
  if (BINARY_IMAGE_EXTENSIONS.has(extension)) return false
  if (IGNORED_DIRECTORY_PATTERN.test(normalized)) return false
  if (GENERATED_DIRECTORY_PATTERN.test(normalized)) return false
  if (GENERATED_API_SNAPSHOT_PATTERN.test(normalized)) return false
  if (MIGRATION_PATTERN.test(normalized)) return false
  if (extension === '.sql' && /(^|\/)drizzle(?:\/|$)/.test(normalized)) return false
  if (isLockfile(normalized) || isPulumiState(normalized)) return false
  if (/\.(?:generated|gen)\.[^.]+$/i.test(normalized)) return false
  return true
}

export function isProductionPath(path) {
  const normalized = normalizePath(path)
  return (
    isHandwrittenSourcePath(normalized) &&
    !TEST_PATH_PATTERN.test(normalized) &&
    !TEST_FILE_PATTERN.test(normalized)
  )
}

export function isGeneratedContent(content) {
  const header = content.split(/\r?\n/, 8).join('\n')
  return /(?:@generated|code generated|generated file|do not edit)/i.test(header)
}

function isLockfile(path) {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  return (
    name === 'bun.lock' ||
    name === 'bun.lockb' ||
    name === 'cargo.lock' ||
    name === 'composer.lock' ||
    name === 'package-lock.json' ||
    name === 'pnpm-lock.yaml' ||
    name === 'poetry.lock' ||
    name === 'uv.lock' ||
    name === 'yarn.lock'
  )
}

function isPulumiState(path) {
  const normalized = path.toLowerCase()
  return (
    normalized.includes('/.pulumi/') ||
    normalized.endsWith('.pulumi-state') ||
    normalized.endsWith('.pulumi-state.json') ||
    /(^|\/)pulumi\.[^.]+\.state(?:\.json)?$/.test(normalized)
  )
}
