import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boundary, defineFlow } from '@openwizard/core'
import type { NitroConfig } from 'nitro/types'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnyHTTPResource, AnyWebhookResource, WizardHTTP } from '../src'
import { withNitro, withNitroAPI, withNitroWebhooks } from '../src/nitro'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function resource(id: string, path: string): AnyWebhookResource {
  return {
    id,
    event: 'shipment.ready',
    path,
    method: 'POST',
    openAPI: {
      tags: ['Webhooks'],
      summary: 'Receive shipment.ready',
      description: 'Receives a shipment event.',
      operationId: 'receiveShipmentReadyWebhook',
      parameters: [],
      requestBody: {},
      responses: { 202: { description: 'Accepted' } },
      'x-standard-webhooks': '1.0.0',
    },
    handle: async () => new Response(null, { status: 202 }),
  }
}

describe('withNitroWebhooks', () => {
  it('writes handlers with static route metadata and enables Nitro OpenAPI', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openwizard-webhooks-'))
    tempDirs.push(rootDir)
    const webhook = resource('shipment-ready', '/webhooks/shipment.ready')

    const config = withNitroWebhooks(
      { rootDir, compatibilityDate: '2026-08-19' },
      {
        resources: [webhook],
        resourceModule: './server/webhooks.ts',
        generatedDir: './generated',
        openAPI: {
          production: 'runtime',
          route: '/api/openapi.json',
          ui: { scalar: false, swagger: false },
        },
      },
    )

    expect(config.openAPI).toMatchObject({
      production: 'runtime',
      route: '/api/openapi.json',
      meta: { title: 'OpenWizard webhook API' },
    })
    expect(config.handlers).toHaveLength(2)
    const webhookHandler = config.handlers?.find((handler) => handler.method === 'POST')
    expect(webhookHandler).toMatchObject({
      route: '/webhooks/shipment.ready',
      method: 'POST',
    })
    const handler = webhookHandler?.handler
    expect(handler).toBeTypeOf('string')
    const source = readFileSync(handler ?? '', 'utf8')
    expect(source).toContain('defineHandler((event) => resource.handle(event.req))')

    const docsHandler = config.handlers?.find((entry) => entry.route === '/api/openapi.json')
    const docsSource = readFileSync(docsHandler?.handler ?? '', 'utf8')
    expect(docsSource).toContain('"operationId": "receiveShipmentReadyWebhook"')
  })

  it('preserves caller config and rejects an existing POST route', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openwizard-webhooks-'))
    tempDirs.push(rootDir)
    const webhook = resource('shipment-ready', '/webhooks/shipment.ready')
    const config: NitroConfig = {
      rootDir,
      compatibilityDate: '2026-08-19',
      handlers: [{ route: webhook.path, method: 'POST', handler: './existing.ts' }],
    }

    expect(() =>
      withNitroWebhooks(config, {
        resources: [webhook],
        resourceModule: './server/webhooks.ts',
      }),
    ).toThrow(/already has a handler/)
  })
})

describe('withNitroAPI', () => {
  it('generates mixed methods, OpenAPI paths, and security schemes', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openwizard-api-'))
    tempDirs.push(rootDir)
    const resources: AnyHTTPResource[] = [
      resource('shipment-ready', '/webhooks/shipment.ready'),
      {
        id: 'orders:run:read',
        path: '/api/orders/:runId',
        openAPIPath: '/api/orders/{runId}',
        method: 'GET',
        openAPI: {
          operationId: 'OrdersGetRun',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Run state' } },
        },
        openAPIComponents: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        },
        handle: async () => Response.json({ ok: true }),
      },
    ]

    const config = withNitroAPI(
      { rootDir, compatibilityDate: '2026-08-19' },
      {
        resources,
        resourceModule: './server/resources.ts',
        generatedDir: './generated',
        openAPI: {
          production: 'runtime',
          route: '/api/openapi.json',
          ui: { scalar: false, swagger: false },
        },
      },
    )

    expect(config.handlers?.filter((handler) => handler.method !== 'GET')).toHaveLength(1)
    expect(config.handlers?.some((handler) => handler.route === '/api/orders/:runId')).toBe(true)
    const docsHandler = config.handlers?.find((handler) => handler.route === '/api/openapi.json')
    const docsSource = readFileSync(docsHandler?.handler ?? '', 'utf8')
    expect(docsSource).toContain('"/api/orders/{runId}"')
    expect(docsSource).toContain('"bearerAuth"')
    expect(docsSource).toContain('"operationId": "OrdersGetRun"')
    expect(docsSource).toContain('"title": "OpenWizard HTTP API"')
  })

  it('merges inherited scopes from APIs that share an OAuth provider', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openwizard-oauth-'))
    tempDirs.push(rootDir)
    const oauthResource = (id: string, path: string, scope: string): AnyHTTPResource => ({
      id,
      path,
      method: 'GET',
      openAPI: { responses: { 200: { description: 'OK' } } },
      openAPIComponents: {
        securitySchemes: {
          oauth2: {
            type: 'oauth2',
            flows: {
              clientCredentials: {
                tokenUrl: 'https://identity.example.test/oauth/token',
                scopes: { [scope]: `Required for ${id}.` },
              },
            },
          },
        },
      },
      handle: async () => Response.json({ ok: true }),
    })

    const config = withNitroAPI(
      { rootDir, compatibilityDate: '2026-08-19' },
      {
        resources: [
          oauthResource('orders:read', '/api/orders/:runId', 'orders:read'),
          oauthResource('orders:webhooks:read', '/api/orders/webhooks', 'orders:webhooks:read'),
        ],
        resourceModule: './server/resources.ts',
        generatedDir: './generated',
        openAPI: { ui: { scalar: false, swagger: false } },
      },
    )

    const docsHandler = config.handlers?.find((handler) => handler.route === '/_openapi.json')
    const docsSource = readFileSync(docsHandler?.handler ?? '', 'utf8')
    expect(docsSource).toContain('"orders:read"')
    expect(docsSource).toContain('"orders:webhooks:read"')
  })
})

describe('withNitro', () => {
  it('mounts a generated registry from its source module', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'openwizard-auto-http-'))
    tempDirs.push(rootDir)
    const builder = defineFlow({ name: 'nitro-auto', context: boundary.trusted<{}>() })
    const flow = builder.steps({ done: builder.final() })
    const webhook = resource('shipment-ready', '/webhooks/shipment.ready')
    const http: WizardHTTP<typeof flow> = {
      id: 'nitro-auto',
      flow,
      resources: [webhook],
      receivers: [webhook],
    }

    const config = withNitro(
      { rootDir, compatibilityDate: '2026-08-19' },
      {
        http,
        source: './server/http.ts',
        generatedDir: './generated',
        openAPI: { ui: { scalar: false, swagger: false } },
      },
    )

    expect(config.openAPI?.meta?.title).toBe('OpenWizard HTTP API')
    const source = readFileSync(
      config.handlers?.find(({ method }) => method === 'POST')?.handler ?? '',
      'utf8',
    )
    expect(source).toContain('const exported = source["http"]')
    expect(source).toContain('exported?.resources')
  })
})
