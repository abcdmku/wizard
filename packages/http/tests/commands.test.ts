import { boundary, defineWizard } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHTTP } from '../src'
import { auth, call } from './fixtures/orders'

const manual = defineWizard(
  { name: 'manual', context: z.object({ n: z.number() }), autoRun: 'manual' },
  ({ step, steps }) => steps({ work: step({ run: ({ context }) => context.n }) }),
)

describe('HTTP command names', () => {
  it('creates a run through a wizard with provided dependencies', async () => {
    const bound = defineWizard(
      { name: 'provided', context: z.object({}), deps: boundary.trusted<{ token: string }>() },
      ({ step, steps }) => steps({ read: step({ run: ({ deps }) => deps.token }) }),
    ).provide({ token: 'bound' })
    const run = bound.create({})
    const http = createHTTP(bound, {
      auth,
      scopes: { create: ['orders:create'], read: ['orders:read'] },
      access: { flow: ['create', 'output'] },
      runs: {
        get: () => run,
        create: async () => {
          await run.start()
          return run
        },
      },
    })
    const response = await http.fetch(call('/api/provided', { token: 'alice', body: {} }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: { status: 'done', output: 'bound' } })
    expect(http.wizard).toBe(bound)
    run.dispose()
  })

  it('starts manual work using startStep or startReady and documents retry patches', async () => {
    const one = manual.create({ n: 1 }, { instanceId: 'one' })
    const two = manual.create({ n: 2 }, { instanceId: 'two' })
    const runs = new Map([
      [one.id, one],
      [two.id, two],
    ])
    const http = createHTTP(manual, {
      runs: { get: ({ runId }) => runs.get(runId) },
      auth,
      scopes: { command: ['orders:command'] },
      access: { flow: ['start', 'startReady'], steps: { work: ['startStep', 'retry'] } },
    })
    const send = (id: string, body: object) =>
      http.fetch(call(`/api/manual/${id}/commands`, { token: 'alice', body }))
    expect((await send('one', { type: 'start' })).status).toBe(200)
    expect((await send('two', { type: 'start' })).status).toBe(200)
    expect((await send('one', { type: 'startStep', step: 'work' })).status).toBe(200)
    expect((await send('two', { type: 'startReady' })).status).toBe(200)
    expect(one.getState().steps.work.output).toBe(1)
    expect(two.getState().steps.work.output).toBe(2)
    for (const body of [{ type: 'run', step: 'work' }, { type: 'runReady' }]) {
      expect((await send('one', body)).status).toBe(400)
    }

    const schemas = http.openAPI({ title: 'Manual', version: '1' }).components.schemas
    expect(schemas.ManualStartStepCommand).toMatchObject({
      required: ['type', 'step'],
      properties: { type: { enum: ['startStep'] }, step: { enum: ['work'] } },
    })
    expect(schemas.ManualStartReadyCommand).toMatchObject({
      required: ['type'],
      properties: { type: { enum: ['startReady'] } },
    })
    expect(schemas.ManualRetryCommand).toMatchObject({
      properties: { patch: { type: 'object', properties: { n: { type: 'number' } } } },
    })
    expect(schemas.ManualRunCommand).toBeUndefined()
    expect(schemas.ManualRunReadyCommand).toBeUndefined()
    one.dispose()
    two.dispose()
  })
})
