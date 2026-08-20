import { createRun, defineFlow, defineProjection, type FlowRun } from '@openwizard/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createBearerScopeProvider,
  createOAuth2ScopeProvider,
  defineRunAPI,
  type RunAPIOptions,
} from '../src'

const builder = defineFlow({
  name: 'external-orders',
  context: z.object({ publicId: z.string(), secret: z.string() }),
  autoRun: 'manual',
})
const flow = builder.steps({
  fetch: builder.task(() => ({ total: 42 })),
  done: builder.final({ output: ({ steps }) => steps.fetch?.output }),
})
const projection = defineProjection(flow, {
  expose: {
    context: ['publicId'],
    steps: { fetch: { output: true } },
    progress: true,
  },
})

type Principal = { readonly accountId: string }

const scopeProvider = createBearerScopeProvider<Principal>({
  bearerFormat: 'JWT',
  verify: (token) => {
    if (token === 'read') {
      return {
        tenantId: 'acct-1',
        principal: { accountId: 'acct-1' },
        scopes: ['orders:read'],
      }
    }
    if (token === 'command') {
      return {
        tenantId: 'acct-1',
        principal: { accountId: 'acct-1' },
        scopes: ['orders:read', 'orders:command'],
      }
    }
    return null
  },
})

function createOrderRun(): FlowRun<typeof flow> {
  return createRun(flow, { context: { publicId: 'order-1', secret: 'do-not-return' } })
}

function createAPI(
  run: FlowRun<typeof flow>,
  overrides: Partial<RunAPIOptions<typeof flow, ReturnType<typeof run.project>, Principal>> = {},
) {
  return defineRunAPI({
    flow,
    id: 'orders',
    basePath: '/api/orders',
    projection,
    scopeProvider,
    resolveRun: ({ runId, tenantId }) =>
      runId === run.id && tenantId === 'acct-1' ? run : undefined,
    commands: {
      allow: ({ command }) => command.type === 'run' && command.step === 'fetch',
    },
    ...overrides,
  })
}

function resource(api: ReturnType<typeof createAPI>, method: 'GET' | 'POST', ending: string) {
  const found = api.resources.find(
    (candidate) => candidate.method === method && candidate.path.endsWith(ending),
  )
  if (found === undefined) throw new Error(`resource ${method} *${ending} not found`)
  return found
}

function request(
  url: string,
  options: { readonly method?: string; readonly token?: string; readonly body?: unknown } = {},
): Request {
  return new Request(url, {
    ...(options.method === undefined ? {} : { method: options.method }),
    headers: {
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

describe('defineRunAPI', () => {
  it('authenticates before resolving and requires every read scope', async () => {
    const run = createOrderRun()
    const resolveRun = vi.fn(() => run)
    const api = createAPI(run, { resolveRun })
    const endpoint = resource(api, 'GET', '/:runId')

    const missing = await endpoint.handle(request(`https://example.test/api/orders/${run.id}`))
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect(resolveRun).not.toHaveBeenCalled()

    const forbidden = await endpoint.handle(
      request(`https://example.test/api/orders/${run.id}`, { token: 'unknown' }),
    )
    expect(forbidden.status).toBe(401)
    expect(resolveRun).not.toHaveBeenCalled()
  })

  it('returns the client projection and never leaks unprojected context', async () => {
    const run = createOrderRun()
    const api = createAPI(run)
    const endpoint = resource(api, 'GET', '/:runId')
    const response = await endpoint.handle(
      request(`https://example.test/api/orders/${run.id}`, { token: 'read' }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      data: { instanceId: run.id, context: { publicId: 'order-1' } },
    })
    expect(JSON.stringify(body)).not.toContain('do-not-return')
  })

  it('parses, scopes, and policy-checks commands before dispatch', async () => {
    const run = createOrderRun()
    await run.start()
    const api = createAPI(run)
    const endpoint = resource(api, 'POST', '/commands')
    const url = `https://example.test/api/orders/${run.id}/commands`

    const noScope = await endpoint.handle(
      request(url, { method: 'POST', token: 'read', body: { type: 'run', step: 'fetch' } }),
    )
    expect(noScope.status).toBe(403)

    const invalid = await endpoint.handle(
      request(url, { method: 'POST', token: 'command', body: { type: 'run', step: 'missing' } }),
    )
    expect(invalid.status).toBe(400)

    const denied = await endpoint.handle(
      request(url, { method: 'POST', token: 'command', body: { type: 'reset' } }),
    )
    expect(denied.status).toBe(403)

    const accepted = await endpoint.handle(
      request(url, { method: 'POST', token: 'command', body: { type: 'run', step: 'fetch' } }),
    )
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toMatchObject({ ok: true, result: { ok: true } })
    expect(run.getState().steps.fetch.output).toEqual({ total: 42 })
  })

  it('returns projected step data and generates scoped OpenAPI metadata', async () => {
    const run = createOrderRun()
    await run.start()
    await run.run('fetch')
    const api = createAPI(run)
    const endpoint = resource(api, 'GET', '/steps/:step')
    const response = await endpoint.handle(
      request(`https://example.test/api/orders/${run.id}/steps/fetch`, { token: 'read' }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { id: 'fetch', status: 'done', output: { total: 42 } },
    })
    expect(endpoint.openAPIPath).toBe('/api/orders/{runId}/steps/{step}')
    expect(endpoint.openAPI).toMatchObject({
      operationId: 'OrdersGetStep',
      security: [{ bearerAuth: [] }],
      'x-required-scopes': ['orders:read'],
    })
    expect(endpoint.openAPIComponents).toMatchObject({
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    })
  })

  it('validates read-step allowlists and request methods', async () => {
    const run = createOrderRun()
    expect(() => createAPI(run, { readSteps: ['missing' as 'fetch'] })).toThrow(/unknown step/)
    const endpoint = resource(createAPI(run), 'GET', '/:runId')
    const response = await endpoint.handle(
      request(`https://example.test/api/orders/${run.id}`, { method: 'POST', token: 'read' }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('inherits generated OAuth scopes into the flow documentation', () => {
    const run = createOrderRun()
    const oauth = createOAuth2ScopeProvider<Principal>({
      verify: () => ({
        tenantId: 'acct-1',
        principal: { accountId: 'acct-1' },
        scopes: ['orders:read'],
      }),
      flows: {
        clientCredentials: {
          tokenUrl: 'https://identity.example.test/oauth/token',
          scopes: 'inherit',
        },
      },
    })
    const api = createAPI(run, { scopeProvider: oauth })
    const endpoint = resource(api, 'GET', '/:runId')

    expect(endpoint.openAPI).toMatchObject({ security: [{ oauth2: ['orders:read'] }] })
    expect(endpoint.openAPIComponents).toMatchObject({
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              scopes: {
                'orders:read': expect.any(String),
                'orders:command': expect.any(String),
              },
            },
          },
        },
      },
    })
  })
})
