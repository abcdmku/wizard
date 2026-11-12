import { createTestScheduler } from '@openwizard/core/testing'
import { Effect, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../src/delivery-effects'
import type { AutomatedAction, DeliveryContext } from '../src/delivery-model'
import { makeDeliveryWizard } from '../src/delivery-wizard'

const settle = async (): Promise<void> => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

describe('fleet delivery interventions', () => {
  it('completes a delivery directly from normal transit', async () => {
    const scheduler = createTestScheduler({ now: 10_000 })
    const actions: AutomatedAction[] = []
    const runtime = ManagedRuntime.make(
      makeDeliveryEffectsLayer((command) =>
        Effect.sync(() => {
          actions.push(command.action)
          return { action: command.action, recordedAtMs: scheduler.now() }
        }),
      ),
    )
    const context: DeliveryContext = {
      tenantId: 'tenant-lakeshore',
      deliveryId: 'delivery-1',
      procedureState: 'assignment',
      anomalyResolved: true,
    }
    const run = makeDeliveryWizard(runtime).create(context, {
      scheduler,
      instanceId: 'intervention-delivery-run',
    })

    try {
      await run.start()
      await settle()
      await run.send('pickupConfirmed', { at: scheduler.now() })
      await settle()
      await run.send('intervention', {
        commandId: 'complete-1',
        action: 'complete',
        actorRole: 'dispatcher',
        at: scheduler.now(),
      })
      await settle()

      expect(actions).toEqual(['start_assignment', 'mark_complete'])
      expect(run.getState().context.procedureState).toBe('completion')
      expect(run.result()).toMatchObject({ status: 'done', output: { state: 'completion' } })
    } finally {
      run.dispose()
      await runtime.dispose()
    }
  })

  it('cancels an intervention event instead of keeping its wait active', async () => {
    const scheduler = createTestScheduler({ now: 20_000 })
    const runtime = ManagedRuntime.make(
      makeDeliveryEffectsLayer((command) =>
        Effect.succeed({ action: command.action, recordedAtMs: scheduler.now() }),
      ),
    )
    const run = makeDeliveryWizard(runtime).create(
      {
        tenantId: 'tenant-lakeshore',
        deliveryId: 'delivery-1',
        procedureState: 'assignment',
        anomalyResolved: true,
      },
      {
        scheduler,
        instanceId: 'cancel-intervention-run',
      },
    )

    try {
      await run.start()
      await settle()
      await run.send('pickupConfirmed', { at: scheduler.now() })
      await settle()
      await run.send('intervention', {
        commandId: 'cancel-1',
        action: 'cancel',
        actorRole: 'dispatcher',
        reason: 'operator request',
        at: scheduler.now(),
      })
      await settle()

      expect(run.getState().context.procedureState).toBe('cancellation')
      expect(run.result()).toMatchObject({ status: 'cancelled' })
    } finally {
      run.dispose()
      await runtime.dispose()
    }
  })
})
