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

/**
 * Changes a queue's visibility timeout and returns once every receive uses the new value.
 *
 * A receive reads the timeout when it starts. The Lambda event source mapping long-polls the
 * queue, so a poll that is already open hands the next message out with the old timeout. A
 * message published straight after the change could then stay hidden for the old 120 seconds,
 * which is longer than any test waits. Waiting for the longest poll to end closes that window.
 */
export async function setVisibilityTimeout(url: string, seconds: number): Promise<void> {
  await localstack([
    'sqs',
    'set-queue-attributes',
    '--queue-url',
    url,
    '--attributes',
    JSON.stringify({ VisibilityTimeout: String(seconds) }),
  ])
  const openPollMs = (await longestWorkerPollSeconds(url)) * 1_000
  await new Promise<void>((resolve) => setTimeout(resolve, openPollMs + 1_000))
}

/** The longest time a Lambda event source mapping keeps one receive open on the queue. */
async function longestWorkerPollSeconds(url: string): Promise<number> {
  const arn = await localstack([
    'sqs',
    'get-queue-attributes',
    '--queue-url',
    url,
    '--attribute-names',
    'QueueArn',
    '--query',
    'Attributes.QueueArn',
    '--output',
    'text',
  ])
  const windows = await localstack([
    'lambda',
    'list-event-source-mappings',
    '--event-source-arn',
    arn,
    '--query',
    'EventSourceMappings[].MaximumBatchingWindowInSeconds',
    '--output',
    'json',
  ])
  const parsed: unknown = JSON.parse(windows)
  if (!Array.isArray(parsed)) throw new Error(`LocalStack listed no mappings for ${arn}`)
  return Math.max(0, ...parsed.filter((value) => typeof value === 'number'))
}
