/**
 * Event delivery dedupe: `send(event, payload, { eventId })` remembers delivered ids
 * in the snapshot; a redelivery is `{ ok: true, duplicate: true }` and changes nothing.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'
import { createTestScheduler } from '../../src/testing'

const purchase = defineWizard(
  {
    name: 'purchase',
    context: z.object({ approvals: z.array(z.string()) }),
    events: { approve: z.object({ by: z.string() }) },
  },
  ({ step, steps }) =>
    steps({
      manager: step({
        waitFor: {
          approve: ({ payload, context, update }) => {
            update({ approvals: [...context.approvals, `manager:${payload.by}`] })
            return { done: payload }
          },
        },
        next: 'director',
      }),
      director: step({
        waitFor: {
          approve: ({ payload, context, update }) => {
            update({ approvals: [...context.approvals, `director:${payload.by}`] })
            return { done: payload }
          },
        },
        next: 'end',
      }),
      end: step({ run: ({ context }) => context.approvals }),
    }),
)

describe('send eventId dedupe', () => {
  it('a redelivered event is a duplicate and never satisfies the next wait', async () => {
    const run = purchase.create({ approvals: [] })
    await run.start()
    expect(await run.send('approve', { by: 'mia' }, { eventId: 'evt_1' })).toMatchObject({
      ok: true,
      delivered: ['manager'],
    })
    const seq = run.getState().seq
    expect(await run.send('approve', { by: 'mia' }, { eventId: 'evt_1' })).toEqual({
      ok: true,
      duplicate: true,
      delivered: [],
      buffered: false,
      seq,
    })
    // The wire door dedupes the same way.
    expect(
      await run.dispatch({
        type: 'send',
        event: 'approve',
        payload: { by: 'mia' },
        eventId: 'evt_1',
      }),
    ).toEqual({ ok: true, seq })
    expect(run.getState().seq).toBe(seq)
    expect(run.waitingFor()).toEqual([
      { kind: 'event', path: [], step: 'director', events: ['approve'] },
    ])
    expect(run.getState().context.approvals).toEqual(['manager:mia'])
    run.dispose()
  })

  it('remembers ids across a snapshot round trip within the ttl and keeps at most `limit`', async () => {
    const counter = defineWizard(
      { name: 'counter', context: z.object({ n: z.number() }), events: { ping: z.object({}) } },
      ({ step, steps }) =>
        steps({
          tally: step({
            waitFor: {
              ping: ({ context, update }) => {
                update({ n: context.n + 1 })
                return { keep: true }
              },
            },
          }),
        }),
    )
    const scheduler = createTestScheduler({ now: 0 })
    const options = { scheduler, eventIds: { ttl: '1m', limit: 2 } } as const
    const run = counter.create({ n: 0 }, options)
    await run.start()
    for (const eventId of ['a', 'b', 'c']) await run.send('ping', {}, { eventId })
    expect(run.getState().eventIds).toEqual([
      { id: 'b', at: 0 },
      { id: 'c', at: 0 },
    ])

    const resumed = counter.resume(JSON.parse(JSON.stringify(run.getSnapshot())), options)
    run.dispose()
    expect(await resumed.send('ping', {}, { eventId: 'c' })).toMatchObject({ duplicate: true })
    expect(await resumed.send('ping', {}, { eventId: 'a' })).toMatchObject({ delivered: ['tally'] })
    scheduler.advance(60_000)
    expect(await resumed.send('ping', {}, { eventId: 'c' })).toMatchObject({ delivered: ['tally'] })
    expect(resumed.getState().context.n).toBe(5)
    resumed.dispose()
  })
})
