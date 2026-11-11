import { defineProjection, defineWizard } from '@openwizard/core'
import { createMirror } from '@openwizard/core/mirror'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHTTP } from '../src'
import { httpTransport } from '../src/client'
import { auth, call, memoryRuns, orders } from './fixtures/orders'

const projection = defineProjection(orders, {
  expose: { context: ['orderId'], steps: { review: { input: true }, ship: { output: true } } },
})

describe('httpTransport', () => {
  it('streams opted-in progress without advancing the SSE reconnect id', async () => {
    const work = defineWizard(
      { name: 'progress', context: z.object({}), autoRun: 'manual' },
      ({ step, steps }) =>
        steps({
          upload: step({
            run: ({ progress }) => {
              progress({ bytes: 3 })
              return true
            },
          }),
        }),
    )
    const run = work.create({}, { instanceId: 'p-1' })
    await run.start()
    const http = createHTTP(work, {
      runs: { get: () => run },
      auth,
      scopes: { read: ['orders:read'] },
      access: { flow: ['read'] },
      projection: defineProjection(work, { expose: { steps: { upload: { progress: true } } } }),
    })
    const response = await http.fetch(call('/api/progress/p-1/stream', { token: 'alice' }))
    await run.startStep('upload')
    const blocks = (await response.text()).trim().split('\n\n')
    const progress = blocks.find((block) => block.includes('"kind":"progress"'))
    expect(progress).toMatch(/^event: frame\ndata: /)
    expect(progress).not.toContain('id: ')
    expect(progress).toContain('"value":{"bytes":3}')
    expect(
      blocks
        .filter((block) => block.includes('"kind":"snapshot"'))
        .every((block) => block.startsWith('id: ')),
    ).toBe(true)
    run.dispose()
  })

  it('drives a typed Mirror through the generated stream route', async () => {
    const runs = memoryRuns()
    const run = runs.add(
      'acme',
      orders.create({ orderId: 'o-1', secret: 's3cret' }, { instanceId: 'o-1' }),
    )
    await run.start()
    const http = createHTTP(orders, {
      runs,
      auth,
      projection,
      access: {
        flow: ['read', 'next'],
        steps: { review: ['setInput'] },
        events: ['payment.captured'],
      },
    })
    const mirror = createMirror<typeof projection>({
      transport: httpTransport('https://api.test/api/orders/o-1/stream', {
        fetch: http.fetch,
        headers: { authorization: 'Bearer alice' },
      }),
    })

    await vi.waitFor(() => expect(mirror.connected).toBe(true))
    expect(mirror.getSnapshot()).toMatchObject({
      instanceId: 'o-1',
      status: 'waiting',
      current: 'review',
      context: { orderId: 'o-1' },
    })

    expect(await mirror.setInput('review', { note: 'gift' })).toEqual({
      ok: true,
      seq: run.getState().seq,
    })
    expect(await mirror.next()).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(mirror.getSnapshot()?.current).toBe(null))
    expect(mirror.getSnapshot()?.steps.review.input).toEqual({ note: 'gift' })

    expect(await mirror.send('payment.captured', { amount: 4200 })).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(mirror.getSnapshot()?.status).toBe('done'))
    expect(mirror.getSnapshot()?.steps.ship.output).toEqual({ trackingId: 'T-1' })
    // The server ends the stream once the run is final.
    await vi.waitFor(() => expect(mirror.connected).toBe(false))
    expect(await mirror.cancel()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'this API does not expose cancel here',
    })
    mirror.dispose()
  })
})
