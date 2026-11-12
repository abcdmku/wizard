import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Action, StartRequest } from '../wire'
import type { Registry } from './registry'
import type { RunStore } from './runs'

/** What the API routes read and change. */
export interface ApiContext {
  readonly registry: () => Registry
  readonly runs: RunStore
  readonly reload: () => Promise<void>
  /** Registers a response as an event stream. */
  readonly subscribe: (response: ServerResponse) => void
}

const MAX_BODY = 1_000_000

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    .end(JSON.stringify(body))
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('The request body is larger than 1 MB.')
    chunks.push(chunk as Buffer)
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Answers a request under `/api`. Returns false for a path it does not know, so the caller can
 * send a 404.
 */
export async function handleApi(
  context: ApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = request.method ?? 'GET'
  const [, , resource, id, sub] = pathname.split('/')

  if (resource === 'stream' && method === 'GET') {
    context.subscribe(response)
    return true
  }
  if (resource === 'catalog' && method === 'GET') {
    json(response, 200, context.registry().catalog)
    return true
  }
  if (resource === 'reload' && method === 'POST') {
    await context.reload()
    json(response, 200, context.registry().catalog)
    return true
  }
  if (resource !== 'runs') return false

  if (id === undefined || id === '') {
    if (method === 'GET') {
      json(response, 200, context.runs.list())
      return true
    }
    if (method === 'POST') {
      const started = context.runs.start((await body(request)) as StartRequest)
      json(response, started.ok ? 201 : 422, started)
      return true
    }
    return false
  }

  const runId = decodeURIComponent(id)
  if (sub === undefined && method === 'GET') {
    const detail = context.runs.get(runId)
    json(response, detail === undefined ? 404 : 200, detail ?? { message: 'No such run.' })
    return true
  }
  if (sub === undefined && method === 'DELETE') {
    json(response, context.runs.remove(runId) ? 200 : 404, { ok: true })
    return true
  }
  if (sub === 'actions' && method === 'POST') {
    const result = await context.runs.act(runId, (await body(request)) as Action)
    json(response, result.ok ? 200 : 422, result)
    return true
  }
  return false
}
