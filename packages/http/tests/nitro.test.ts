import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHTTP } from '../src'
import { withNitro } from '../src/nitro'
import { auth, memoryRuns, orders } from './fixtures/orders'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openwizard-nitro-'))
  roots.push(dir)
  return dir
}

const http = createHTTP(orders, {
  runs: memoryRuns(),
  auth,
  access: { flow: ['read', 'cancel'] },
})

describe('withNitro', () => {
  it('routes every generated path to http.fetch and serves the OpenAPI document', () => {
    const config = withNitro(
      { rootDir: root(), compatibilityDate: '2026-08-19' },
      {
        http,
        source: './server/http.ts',
        generatedDir: './generated',
        openAPI: {
          route: '/openapi.json',
          meta: { title: 'Orders' },
          ui: { scalar: false, swagger: false },
        },
      },
    )
    expect(config.handlers?.map(({ route, method }) => `${method ?? 'ALL'} ${route}`)).toEqual([
      'ALL /api/orders/:runId',
      'ALL /api/orders/:runId/stream',
      'ALL /api/orders/:runId/commands',
      'GET /openapi.json',
    ])
    const [route, , , document] = config.handlers ?? []
    expect(readFileSync(route?.handler ?? '', 'utf8')).toContain(
      'export default defineHandler((event) => http.fetch(event.req))',
    )
    const served = readFileSync(document?.handler ?? '', 'utf8')
    expect(served).toContain('"title": "Orders"')
    expect(served).toContain('"operationId": "ordersGetRun"')
  })

  it('refuses a path Nitro already handles', () => {
    expect(() =>
      withNitro(
        {
          rootDir: root(),
          compatibilityDate: '2026-08-19',
          handlers: [{ route: '/api/orders/:runId', handler: './existing.ts' }],
        },
        { http, source: './server/http.ts', openAPI: false },
      ),
    ).toThrow("Nitro already has a handler for '/api/orders/:runId'")
  })
})
