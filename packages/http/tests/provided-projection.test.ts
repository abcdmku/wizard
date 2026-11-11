import { isWizardError } from '@openwizard/core'
import { createMirror } from '@openwizard/core/mirror'
import { expect, it, vi } from 'vitest'
import { createHTTP } from '../src'
import { httpTransport } from '../src/client'
import { auth, call } from './fixtures/orders'
import { baseProjection, baseWizard, moduleWizard } from './fixtures/provided'

it('reads and streams a module projection from a wizard with provided dependencies', async () => {
  const bound = baseWizard.provide({ prefix: 'bound' })
  const run = bound.create({ orderId: 'o-1' }, { instanceId: 'run-1' })
  await run.start()
  const http = createHTTP(bound, {
    auth,
    runs: { get: () => run },
    projection: baseProjection,
    scopes: { read: ['orders:read'], command: ['orders:command'] },
    access: { flow: ['read'], steps: { work: ['startStep'] } },
  })
  const response = await http.fetch(call('/api/provided-projection/run-1', { token: 'alice' }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: { context: { orderId: 'o-1' } } })
  expect(http.wizard).toBe(bound)

  const mirror = createMirror<typeof baseProjection>({
    transport: httpTransport('https://api.test/api/provided-projection/run-1/stream', {
      fetch: http.fetch,
      headers: { authorization: 'Bearer alice' },
    }),
  })
  await vi.waitFor(() => expect(mirror.connected).toBe(true))
  expect(await mirror.startStep('work')).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(mirror.getSnapshot()?.status).toBe('done'))
  expect(mirror.getSnapshot()?.steps.work.output).toBe('bound:o-1')
  mirror.dispose()
  run.dispose()
})

it('rejects a projection from a separately authored wizard with the same name and shape', async () => {
  const twin = moduleWizard().provide({ prefix: 'bound' })
  const run = twin.create({ orderId: 'o-1' }, { instanceId: 'run-1' })
  await run.start()
  const errors: unknown[] = []
  const http = createHTTP(twin, {
    auth,
    runs: { get: () => run },
    projection: baseProjection,
    scopes: { read: ['orders:read'] },
    access: { flow: ['read'] },
    onError: (error) => {
      errors.push(error)
    },
  })
  for (const suffix of ['', '/stream']) {
    const response = await http.fetch(
      call(`/api/provided-projection/run-1${suffix}`, { token: 'alice' }),
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
  }
  expect(errors.map((error) => (isWizardError(error) ? error.code : undefined))).toEqual([
    'DEFINITION_INVALID',
    'DEFINITION_INVALID',
  ])
  run.dispose()
})
