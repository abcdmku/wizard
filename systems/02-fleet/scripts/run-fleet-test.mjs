import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const systemRoot = fileURLToPath(new URL('..', import.meta.url))
const mode = process.argv[2]
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(args, variables) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      cwd: systemRoot,
      env: { ...process.env, ...variables },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`pnpm ${args.join(' ')} stopped with ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

if (mode === 'integration') {
  process.exit(
    await run(['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
      FLEET_INTEGRATION: '1',
    }),
  )
}

if (mode === 'e2e') {
  const buildCode = await run(['--filter', '@openwizard/fleet-shared', 'run', 'build'], {
    FLEET_E2E: '1',
  })
  if (buildCode !== 0) process.exit(buildCode)
  process.exit(
    await run(['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
      FLEET_E2E: '1',
    }),
  )
}

console.error('Usage: pnpm test:integration | pnpm test:e2e')
process.exit(2)
