import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi } from './api'
import { loadEntry, watchFiles } from './load'
import { failedRegistry, type Registry, registryFrom } from './registry'
import { createRunStore } from './runs'
import { serveStatic } from './static'

/**
 * What `startDevServer` takes: the `entry` file that exports the wizards or a `defineDev`
 * config, the `port` (default 4400, `0` for any free port), the `host` (default `127.0.0.1`)
 * and `watch` (default true) to reload when a source file changes.
 * @public
 */
export interface DevServerOptions {
  readonly entry: string
  readonly port?: number
  readonly host?: string
  readonly watch?: boolean
}

/**
 * A running dev server: its `url`, `reload()` to load the entry file again and `close()`.
 * @public
 */
export interface DevServer {
  readonly url: string
  readonly port: number
  reload(): Promise<void>
  close(): Promise<void>
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** The host name of a `Host` or `Origin` value, without the port. */
function hostOf(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return ''
  }
}

/**
 * Starts the dev server: loads the entry file, serves the browser UI and the API it uses, and
 * reloads the wizards when a source file changes. Runs live in memory and end with the server.
 *
 * It accepts requests for a local host name only, and a write must be JSON from the same
 * origin, so a web page on another site cannot drive a run.
 * @public
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const entry = resolve(options.entry)
  const host = options.host ?? '127.0.0.1'
  const allowed = new Set([...LOCAL, host])
  const ui = fileURLToPath(new URL('./ui', import.meta.url))

  let registry: Registry = failedRegistry(entry, 'The entry file has not loaded yet.', Date.now())
  const streams = new Set<ServerResponse>()
  const emit = (data: object): void => {
    const frame = `data: ${JSON.stringify(data)}\n\n`
    for (const stream of streams) stream.write(frame)
  }

  // A run can change many times in one tick. The UI needs one notice.
  const dirty = new Set<string>()
  let flush: ReturnType<typeof setTimeout> | undefined
  const runs = createRunStore(
    () => registry,
    (id) => {
      dirty.add(id)
      flush ??= setTimeout(() => {
        flush = undefined
        for (const run of dirty) emit({ run })
        dirty.clear()
      }, 25)
    },
  )

  const reload = async (): Promise<void> => {
    try {
      const load = await loadEntry(entry)
      registry = registryFrom(entry, load, Date.now())
      files?.set(load.files)
    } catch (error) {
      registry = failedRegistry(entry, error, Date.now())
    }
    emit({ catalog: true })
  }
  const files = options.watch === false ? undefined : watchFiles(() => void reload())
  files?.set([entry])
  await reload()

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://local')
    if (!allowed.has(hostOf(request.headers.host ?? ''))) {
      response.writeHead(403).end('Forbidden host')
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      serveStatic(ui, url.pathname, response)
      return
    }
    const write = request.method !== 'GET' && request.method !== 'HEAD'
    const origin = request.headers.origin
    const foreign = origin !== undefined && hostOf(origin) !== hostOf(request.headers.host ?? '')
    const typed = (request.headers['content-type'] ?? '').startsWith('application/json')
    if (write && (foreign || (request.method === 'POST' && !typed))) {
      response.writeHead(403).end('Forbidden origin')
      return
    }
    if (
      !(await handleApi(
        { registry: () => registry, runs, reload, subscribe },
        request,
        response,
        url.pathname,
      ))
    )
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not found"}')
  }

  const subscribe = (response: ServerResponse): void => {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    response.write(': connected\n\n')
    streams.add(response)
    response.on('close', () => streams.delete(response))
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) return response.end()
      response.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    })
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? 4400, host, done)
  })
  const { port } = server.address() as AddressInfo

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    port,
    reload,
    async close() {
      files?.close()
      clearTimeout(flush)
      runs.dispose()
      for (const stream of streams) stream.end()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
