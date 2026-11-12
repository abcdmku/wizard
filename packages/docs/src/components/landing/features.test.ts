import { createBearerScopeProvider, createHTTP } from '@openwizard/http'
import { expect, it } from 'vitest'
import { refund, refundPage } from '../../../snippets/agents/refund'
import { refundDocRows, refundRoutes, refundWebhook } from './features'

it('the home page shows the routes the refund wizard really serves', () => {
  const http = createHTTP(refund, {
    runs: {
      get: () => undefined,
      create: () => {
        throw new Error('the test serves no request')
      },
    },
    auth: createBearerScopeProvider({ verify: () => null }),
    access: { run: ['create', 'read'], events: ['refund.approved'] },
    receive: {
      events: ['refund.approved'],
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      resolve: () => undefined,
    },
  })
  const document = http.openAPI({ title: 'Refund', version: '1' }) as {
    paths: Record<string, Record<string, unknown>>
  }
  const routes = Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
  )
  expect(routes).toEqual([...refundRoutes, refundWebhook])
})

it('the home page quotes rows the generated page really prints', () => {
  for (const row of refundDocRows) expect(refundPage).toContain(row)
  expect(refundPage).toContain('pay<br/>2 retries')
})
