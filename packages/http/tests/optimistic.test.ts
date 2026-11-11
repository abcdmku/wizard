import { defineWizard } from '@openwizard/core'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createHTTP } from '../src'
import { auth, call } from './fixtures/orders'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function pendingEvent() {
  const parsing = deferred()
  const release = deferred()
  const work = deferred<number>()
  const event = z.object({ slow: z.boolean().optional() }).superRefine(async ({ slow }) => {
    if (slow) {
      parsing.resolve()
      await release.promise
    }
  })
  const wizard = defineWizard(
    { name: 'optimistic', context: z.object({ n: z.number() }), events: { ping: event } },
    ({ step, view, steps }) =>
      steps(
        {
          background: step({ run: () => work.promise }),
          wait: step({
            waitFor: {
              ping: ({ update }) => {
                update((context) => ({ n: context.n + 1 }))
                return { keep: true }
              },
            },
          }),
          form: view({ input: z.object({ note: z.string() }) }),
        },
        { start: ['background', 'wait', 'form'] },
      ),
  )
  const run = wizard.create({ n: 0 }, { instanceId: 'run-1' })
  await run.start()
  const http = createHTTP(wizard, {
    auth,
    runs: { get: () => run },
    scopes: { command: ['orders:command'] },
    access: { events: ['ping'], flow: ['cancel'], steps: { form: ['setInput'] } },
  })
  const wire = {
    commandId: 'slow',
    instanceId: run.id,
    expectedSeq: run.getState().seq,
    command: { type: 'send', event: 'ping', payload: { slow: true } },
  }
  const send = () =>
    http.fetch(call('/api/optimistic/run-1/stream', { token: 'alice', body: wire }))
  const slow = send()
  await parsing.promise
  const mutate = (path: string, body: object) =>
    http.fetch(call(`/api/optimistic/run-1/${path}`, { token: 'alice', body }))
  return { run, release, work, wire, slow, send, mutate }
}

it('rejects a wire event if a REST event commits during its async validation', async () => {
  const { run, release, wire, slow, send, mutate } = await pendingEvent()
  expect((await mutate('events/ping', {})).status).toBe(200)
  expect(run.getState().seq).toBeGreaterThan(wire.expectedSeq)
  release.resolve()
  const first = await slow
  const text = await first.text()
  expect(JSON.parse(text)).toMatchObject({ result: { ok: false, code: 'STALE' } })
  expect(run.getState().context.n).toBe(1)
  const replay = await send()
  expect(replay.headers.get('idempotent-replayed')).toBe('true')
  expect(await replay.text()).toBe(text)
  run.dispose()
})

it('rejects a wire event if a REST input command commits during its async validation', async () => {
  const { run, release, slow, mutate } = await pendingEvent()
  expect(
    (await mutate('commands', { type: 'setInput', step: 'form', patch: { note: 'new' } })).status,
  ).toBe(200)
  release.resolve()
  expect(await (await slow).json()).toMatchObject({ result: { ok: false, code: 'STALE' } })
  expect(run.getState().context.n).toBe(0)
  expect(run.getState().steps.form.input).toEqual({ note: 'new' })
  run.dispose()
})

it('rejects a wire event if background work commits during its async validation', async () => {
  const { run, release, work, wire, slow } = await pendingEvent()
  work.resolve(42)
  await run.whenIdle()
  expect(run.getState().steps.background.output).toBe(42)
  expect(run.getState().seq).toBeGreaterThan(wire.expectedSeq)
  release.resolve()
  expect(await (await slow).json()).toMatchObject({ result: { ok: false, code: 'STALE' } })
  expect(run.getState().context.n).toBe(0)
  run.dispose()
})

it('allows REST cancellation while a wire event boundary is pending', async () => {
  const { run, release, slow, mutate } = await pendingEvent()
  expect((await mutate('commands', { type: 'cancel' })).status).toBe(200)
  expect(run.getState().status).toBe('cancelled')
  release.resolve()
  expect(await (await slow).json()).toMatchObject({ result: { ok: false, code: 'STALE' } })
  expect(run.getState().context.n).toBe(0)
  run.dispose()
})
