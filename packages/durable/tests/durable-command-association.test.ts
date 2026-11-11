import { boundary, defineWizard } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { createDurableRun, createMemoryDurableStore, resumeDurableRun } from '@openwizard/durable'
import { expect, it } from 'vitest'

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('keeps receipts separate when the caller reuses one immutable command object for local dispatch', async () => {
  const entered = deferred()
  const finish = deferred()
  let parses = 0
  const ping = {
    '~standard': {
      version: 1 as const,
      vendor: 'durable-reused-command-test',
      async validate(_input: unknown) {
        const n = ++parses
        if (n === 1) {
          entered.resolve()
          await finish.promise
        }
        return { value: { n } }
      },
    },
  }
  const wizard = defineWizard(
    {
      name: 'durable-reused-command',
      context: boundary.trusted<{ readonly values: readonly number[] }>(),
      events: { ping },
    },
    ({ step, steps }) =>
      steps({
        wait: step({
          waitFor: {
            ping: ({ payload, update }) => {
              update((context) => ({ values: [...context.values, payload.n] }))
              return { keep: true }
            },
          },
        }),
      }),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const opened = await createDurableRun(wizard, {
    context: { values: [] },
    key: 'reused-command',
    ownerId: 'worker',
    store,
    scheduler,
    renew: 'manual',
  })
  if (!opened.ok) throw new Error(opened.code)
  await opened.host.dispatch({ type: 'start' }, { commandId: 'start' })
  const command = Object.freeze({ type: 'send', event: 'ping', payload: {} } as const)
  const pending = opened.host.dispatch(command, { commandId: 'ping', digest: 'ping' })
  await entered.promise
  await opened.host.run.dispatch(command)
  await opened.host.run.whenIdle()

  expect(opened.host.run.getState().context.values).toEqual([2])
  await expect(
    store.claimDedupe({ lease: opened.host.lease, id: 'ping', digest: 'ping' }),
  ).resolves.toMatchObject({ ok: true, status: 'pending' })

  finish.resolve()
  const applied = await pending
  expect(applied).toMatchObject({ ok: true, status: 'applied', result: { ok: true } })
  await opened.host.run.whenIdle()
  expect(opened.host.run.getState().context.values).toEqual([2, 1])
  await expect(
    opened.host.dispatch(command, { commandId: 'ping', digest: 'ping' }),
  ).resolves.toEqual({ ...applied, status: 'replayed' })
  expect(opened.host.run.getState().context.values).toEqual([2, 1])
  await opened.host.dispose()
})

it('does not apply a delayed external command claim to an unrelated local input batch', async () => {
  const parsing = deferred()
  const finishParsing = deferred()
  const ping = {
    '~standard': {
      version: 1 as const,
      vendor: 'durable-command-test',
      async validate(_input: unknown) {
        parsing.resolve()
        await finishParsing.promise
        return { value: { n: 1 } }
      },
    },
  }
  const wizard = defineWizard(
    {
      name: 'durable-command-association',
      context: boundary.trusted<Record<string, never>>(),
      events: { ping },
    },
    ({ step, view, steps }) =>
      steps(
        {
          form: view({ input: boundary.trusted<{ readonly name: string }>() }),
          wait: step({ waitFor: { ping: ({ payload }) => ({ done: `pong:${payload.n}` }) } }),
        },
        { start: ['form', 'wait'] },
      ),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const options = { key: 'delayed-command', store, scheduler, renew: 'manual' } as const
  const first = await createDurableRun(wizard, { ...options, context: {}, ownerId: 'owner-a' })
  if (!first.ok) throw new Error(first.code)
  await first.host.dispatch({ type: 'start' }, { commandId: 'start' })

  const abandoned = first.host.dispatch(
    { type: 'send', event: 'ping', payload: {} },
    { commandId: 'ping-1' },
  )
  await parsing.promise
  await first.host.run.setInput('form', { name: 'saved during parsing' })

  scheduler.advance(store.leaseTtlMs)
  const second = await resumeDurableRun(wizard, { ...options, ownerId: 'owner-b' })
  if (!second.ok) throw new Error(second.code)
  expect(second.host.run.getState().steps.form.input).toEqual({ name: 'saved during parsing' })
  finishParsing.resolve()
  await expect(
    second.host.dispatch({ type: 'send', event: 'ping', payload: {} }, { commandId: 'ping-1' }),
  ).resolves.toMatchObject({ ok: true, status: 'applied', result: { ok: true } })
  await second.host.run.whenIdle()
  expect(second.host.run.getState().steps.wait.output).toBe('pong:1')
  await expect(abandoned).resolves.toMatchObject({ ok: false, code: 'LEASE_LOST' })
  await second.host.dispose()
  await first.host.dispose()
})

it('checks the expected version after asynchronous parsing and replays the committed stale refusal', async () => {
  const entered = deferred()
  const finish = deferred()
  const ping = {
    '~standard': {
      version: 1 as const,
      vendor: 'durable-optimistic-command-test',
      async validate(_input: unknown) {
        entered.resolve()
        await finish.promise
        return { value: { n: 1 } }
      },
    },
  }
  const wizard = defineWizard(
    {
      name: 'durable-optimistic-command',
      context: boundary.trusted<{ readonly values: readonly number[] }>(),
      events: { ping },
    },
    ({ step, view, steps }) =>
      steps(
        {
          form: view({ input: boundary.trusted<{ readonly name: string }>() }),
          wait: step({
            waitFor: {
              ping: ({ payload, update }) => {
                update((context) => ({ values: [...context.values, payload.n] }))
                return { keep: true }
              },
            },
          }),
        },
        { start: ['form', 'wait'] },
      ),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const options = { key: 'optimistic-command', store, scheduler, renew: 'manual' } as const
  const opened = await createDurableRun(wizard, {
    ...options,
    context: { values: [] },
    ownerId: 'worker-a',
  })
  if (!opened.ok) throw new Error(opened.code)
  await opened.host.dispatch({ type: 'start' }, { commandId: 'start' })
  const expectedVersion = opened.host.version
  const command = { type: 'send', event: 'ping', payload: {} } as const
  const pending = opened.host.dispatch(command, { commandId: 'ping', expectedVersion })
  await entered.promise
  await opened.host.run.setInput('form', { name: 'changed during parsing' })
  finish.resolve()
  const stale = await pending
  expect(stale).toMatchObject({
    ok: true,
    status: 'applied',
    result: { ok: false, code: 'STALE' },
  })
  expect(opened.host.run.getState().context.values).toEqual([])
  await opened.host.dispose()

  const resumed = await resumeDurableRun(wizard, { ...options, ownerId: 'worker-b' })
  if (!resumed.ok) throw new Error(resumed.code)
  await expect(
    resumed.host.dispatch(command, { commandId: 'ping', expectedVersion }),
  ).resolves.toEqual({ ...stale, status: 'replayed' })
  expect(resumed.host.run.getState().context.values).toEqual([])
  expect(resumed.host.run.getState().steps.form.input).toEqual({
    name: 'changed during parsing',
  })
  await resumed.host.dispose()
})

it('fails closed when navigation was applied but its asynchronous exit never committed a result', async () => {
  const exitStarted = deferred()
  const wizard = defineWizard(
    {
      name: 'durable-interrupted-navigation',
      context: boundary.trusted<Record<string, never>>(),
    },
    ({ view, steps }) =>
      steps({
        a: view({
          input: boundary.trusted<Record<string, never>>(),
          next: 'b',
          async exit() {
            exitStarted.resolve()
            await new Promise<void>(() => undefined)
          },
        }),
        b: view({ input: boundary.trusted<Record<string, never>>() }),
      }),
  )
  const scheduler = createTestScheduler({ now: 0 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const options = { key: 'interrupted-navigation', store, scheduler, renew: 'manual' } as const
  const first = await createDurableRun(wizard, { ...options, context: {}, ownerId: 'owner-a' })
  if (!first.ok) throw new Error(first.code)
  await first.host.dispatch({ type: 'start' }, { commandId: 'start' })
  const pending = first.host.dispatch({ type: 'next' }, { commandId: 'next-1' })
  await exitStarted.promise

  scheduler.advance(store.leaseTtlMs)
  const second = await resumeDurableRun(wizard, { ...options, ownerId: 'owner-b' })
  if (!second.ok) throw new Error(second.code)
  await expect(
    second.host.dispatch({ type: 'next' }, { commandId: 'next-1' }),
  ).resolves.toMatchObject({ ok: false, code: 'COMMAND_INTERRUPTED' })
  expect(second.host.run.getState().current).toBe('a')
  await second.host.dispose()
  first.host.run.dispose()
  await pending
  await first.host.dispose()
})
