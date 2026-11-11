import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const composeFile = fileURLToPath(new URL('../../compose.yaml', import.meta.url))
const systemRoot = fileURLToPath(new URL('../..', import.meta.url))

export async function compose(...args: readonly string[]): Promise<string> {
  const result = await run('docker', ['compose', '-f', composeFile, ...args], {
    cwd: systemRoot,
    maxBuffer: 2_000_000,
  })
  return result.stdout
}
