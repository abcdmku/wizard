import { defineWizard } from '@openwizard/core'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHTTP } from '../src'
import { auth, call, memoryRuns, orders } from './fixtures/orders'

const input = { orderId: 'o-1', secret: 's' }

describe('HTTP wire retries', () => {
  it('rejects the later optimistic send after asynchronous event validation', async () => {
    const event = z.object({}).superRefine(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    })
    const wizard = defineWizard(
      { name: 'async-events', context: z.object({}), events: { ok: event } },
      ({ step, steps }) => steps({ wait: step({ waitFor: { ok: () => ({ done: true }) } }) }),
    )
    const run = wizard.create({}, { instanceId: 'a-1' })
    await run.start()
    const http = createHTTP(wizard, {
      auth,
      runs: { get: () => run },
      scopes: { command: ['orders:command'] },
      access: { events: ['ok'] },
    })
    const expectedSeq = run.getState().seq
    const results = await Promise.all(
      ['first', 'second'].map(async (commandId) => {
        const response = await http.fetch(
          call('/api/async-events/a-1/stream', {
            token: 'alice',
            body: {
              commandId,
              instanceId: run.id,
              expectedSeq,
              command: { type: 'send', event: 'ok', payload: {} },
            },
          }),
        )
        const ack = await response.json()
        return ack.result.ok ? 'accepted' : ack.result.code
      }),
    )
    expect(results.sort()).toEqual(['STALE', 'accepted'])
    run.dispose()
  })

  it('replays the first acknowledgement before checking the changed sequence', async () => {
    const runs = memoryRuns()
    const run = runs.add('acme', orders.create(input, { instanceId: 'o-1' }))
    await run.start()
    const http = createHTTP(orders, {
      runs,
      auth,
      access: { steps: { review: ['setInput'] } },
    })
    const wire = {
      commandId: 'draft-1',
      instanceId: run.id,
      expectedSeq: run.getState().seq,
      command: { type: 'setInput', step: 'review', patch: { note: 'gift' } },
    }
    const send = (body = wire) =>
      http.fetch(call('/api/orders/o-1/stream', { token: 'alice', body }))
    const first = await send()
    const text = await first.text()
    expect(JSON.parse(text)).toMatchObject({ commandId: 'draft-1', result: { ok: true } })
    expect(run.getState().seq).toBeGreaterThan(wire.expectedSeq)

    const replay = await send()
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(await replay.text()).toBe(text)

    const conflict = await send({ ...wire, expectedSeq: run.getState().seq })
    expect(conflict.status).toBe(422)
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    run.dispose()
  })

  it('replays a durable receipt through another HTTP process before sequence gating', async () => {
    const host = createDurableHost(orders, { store: createMemoryDurableStore() })
    const created = await host.create('o-1', input)
    if (!created.ok) throw new Error(created.code)
    const run = created.host.run
    await run.start()
    const makeHTTP = () =>
      createHTTP(orders, {
        auth,
        access: { steps: { review: ['setInput'] } },
        runs: {
          get: async ({ runId }) => {
            const opened = await host.open(runId)
            if (!opened.ok) throw new Error(opened.code)
            return opened.host
          },
        },
      })
    const wire = {
      commandId: 'draft-1',
      instanceId: run.id,
      expectedSeq: run.getState().seq,
      command: { type: 'setInput', step: 'review', patch: { note: 'gift' } },
    }
    const send = (body = wire) =>
      makeHTTP().fetch(call('/api/orders/o-1/stream', { token: 'alice', body }))
    const first = await (await send()).json()
    expect(first).toMatchObject({ commandId: 'draft-1', result: { ok: true } })
    await run.setInput('review', { note: 'later' })

    const replay = await (await send()).json()
    expect(replay.result).toEqual(first.result)
    expect(run.getState().steps.review.input).toEqual({ note: 'later' })

    const conflict = await send({ ...wire, expectedSeq: run.getState().seq })
    expect(conflict.status).toBe(422)
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    const stale = await send({ ...wire, commandId: 'new-command' })
    expect(await stale.json()).toMatchObject({ result: { ok: false, code: 'STALE' } })
    expect(run.getState().steps.review.input).toEqual({ note: 'later' })
    await host.dispose()
  })
})
