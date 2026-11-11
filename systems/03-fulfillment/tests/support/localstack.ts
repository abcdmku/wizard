import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const systemRoot = fileURLToPath(new URL('../..', import.meta.url))

export async function localstack(command: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    'docker',
    ['compose', 'exec', '-T', 'localstack', 'awslocal', ...command],
    { cwd: systemRoot },
  )
  return result.stdout.trim()
}

export async function queueUrl(name: string): Promise<string> {
  const url = await localstack([
    'sqs',
    'get-queue-url',
    '--queue-name',
    name,
    '--query',
    'QueueUrl',
    '--output',
    'text',
  ])
  if (url.length === 0) throw new Error(`LocalStack did not return a URL for ${name}`)
  return url
}
