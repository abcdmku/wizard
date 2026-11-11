import { defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createHTTP, createMemoryIdempotencyStore } from '../src'
import { auth, call } from './fixtures/orders'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('acknowledges the generation reopened while an idempotency store claim awaited I/O', async () => {
  const wizard = defineWizard({ name: 'generation', context: z.object({}) }, ({ step, steps }) =>
    steps({ done: step({ run: () => 42 }) }),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const durable = createDurableHost(wizard, {
    store: createMemoryDurableStore({ now: scheduler.now }),
    scheduler,
    renew: 'manual',
  })
  const opened = await durable.create('run-1', {})
  if (!opened.ok) throw new Error(opened.code)
  await opened.host.dispatch({ type: 'start' }, { commandId: 'start' })
  await opened.host.run.awaitResult()
  const epoch = opened.host.run.epoch
  const claimStarted = deferred()
  const finishClaim = deferred()
  const idempotency = createMemoryIdempotencyStore()
  const http = createHTTP(wizard, {
    auth,
    runs: { get: () => opened.host },
    scopes: { command: ['orders:command'] },
    access: { flow: ['reset'] },
    idempotency: {
      ...idempotency,
      async claim(key, fingerprint) {
        claimStarted.resolve()
        await finishClaim.promise
        return idempotency.claim(key, fingerprint)
      },
    },
  })
  const pending = http.fetch(
    call('/api/generation/run-1/stream', {
      token: 'alice',
      body: { commandId: 'reset', instanceId: 'run-1', command: { type: 'reset' } },
    }),
  )
  await claimStarted.promise
  scheduler.advance(0)
  const reopened = await durable.open('run-1')
  if (!reopened.ok) throw new Error(reopened.code)
  expect(reopened.host.run.epoch).toBeGreaterThan(epoch)
  finishClaim.resolve()
  const ack = await (await pending).json()
  const currentSeq = opened.host.run.getState().seq
  expect(ack.result.ok).toBe(true)
  expect({ ackSeq: ack.seq, resultSeq: ack.result.seq }).toEqual({
    ackSeq: currentSeq,
    resultSeq: currentSeq,
  })
  await durable.dispose()
})
