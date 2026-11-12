import { createReadStream, existsSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
}

const MISSING = `<!doctype html><meta charset="utf-8"><title>OpenWizard dev</title>
<p>The dev UI is not built. Run <code>pnpm --filter @openwizard/dev build</code>. The API under <code>/api</code> works without it.</p>`

/** Serves a file of the built UI, or `index.html` for a path the UI routes itself. */
export function serveStatic(root: string, pathname: string, response: ServerResponse): void {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  let file = join(root, relative)
  // A path that leaves the UI folder gets the UI itself.
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile())
    file = join(root, 'index.html')
  if (!existsSync(file)) {
    response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' }).end(MISSING)
    return
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000',
  })
  createReadStream(file).pipe(response)
}
