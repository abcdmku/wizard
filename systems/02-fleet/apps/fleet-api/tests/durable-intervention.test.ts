import { createTestScheduler } from '@openwizard/core/testing'
import { createDurableRun, createMemoryDurableStore, resumeDurableRun } from '@openwizard/durable'
import { Effect, ManagedRuntime } from 'effect'
import { expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../src/delivery-effects'
import { makeDeliveryFlow } from '../src/delivery-flow'
import { dispatchIntervention } from '../src/durable-commands'

it('keeps intervention version fences, digest conflicts, and saved results across owners', async () => {
  const scheduler = createTestScheduler({ now: 10_000 })
  const store = createMemoryDurableStore({ now: scheduler.now })
  const runtime = ManagedRuntime.make(
    makeDeliveryEffectsLayer((command) =>
      Effect.succeed({ action: command.action, recordedAtMs: scheduler.now() }),
    ),
  )
  const wizard = makeDeliveryFlow(runtime)
  const opened = await createDurableRun(wizard, {
    context: {
      tenantId: 'tenant-lakeshore',
      deliveryId: 'delivery-1',
      procedureState: 'assignment',
      anomalyResolved: true,
    },
    store,
    key: 'intervention-replay',
    ownerId: 'worker-a',
    scheduler,
    renew: 'manual',
  })
  if (!opened.ok) throw new Error(`Could not create delivery: ${opened.code}`)
  let host = opened.host
  try {
    await host.dispatch({ type: 'start' }, { commandId: 'start' })
    await host.run.awaitOutcome()
    await host.send('pickupConfirmed', { at: scheduler.now() }, { eventId: 'pickup' })
    await host.run.awaitOutcome()

    const request = {
      action: 'hold' as const,
      commandId: 'hold-1',
      reason: 'dock clearance',
      expectedVersion: host.version,
    }
    const viewer = { tenantId: 'tenant-lakeshore', role: 'dispatcher' as const }
    expect(await dispatchIntervention(host, request, viewer, scheduler.now())).toMatchObject({
      ok: true,
      status: 'applied',
      result: { ok: true },
    })
    expect(
      await dispatchIntervention(
        host,
        { ...request, reason: 'changed request' },
        viewer,
        scheduler.now(),
      ),
    ).toMatchObject({ ok: false, code: 'DEDUPLICATE_CONFLICT' })
    expect(
      await dispatchIntervention(
        host,
        { ...request, commandId: 'hold-2' },
        viewer,
        scheduler.now(),
      ),
    ).toMatchObject({ ok: false, code: 'CAS_CONFLICT' })

    await host.dispose()
    const resumed = await resumeDurableRun(wizard, {
      store,
      key: 'intervention-replay',
      ownerId: 'worker-b',
      scheduler,
      renew: 'manual',
    })
    if (!resumed.ok) throw new Error(`Could not resume delivery: ${resumed.code}`)
    host = resumed.host
    const beforeReplay = host.version
    expect(await dispatchIntervention(host, request, viewer, scheduler.now())).toMatchObject({
      ok: true,
      status: 'replayed',
      result: { ok: true },
    })
    expect(host.version).toEqual(beforeReplay)
  } finally {
    await host.dispose()
    await runtime.dispose()
  }
})
