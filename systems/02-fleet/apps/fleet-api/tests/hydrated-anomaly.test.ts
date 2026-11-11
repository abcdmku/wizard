import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { Clock, Duration, Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../src/delivery-effects'
import { makeDeliveryFlow } from '../src/delivery-flow'
import type { AutomatedAction, DeliveryContext } from '../src/delivery-model'

const settle = async (): Promise<void> => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function effectClock(scheduler: TestScheduler): Clock.Clock {
  const millis = (): number => scheduler.now()
  const nanos = (): bigint => BigInt(Math.trunc(millis() * 1_000_000))
  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) => Effect.sync(() => scheduler.advance(Duration.toMillis(duration))),
  }
}

describe('hydrated fleet delivery recovery', () => {
  it('scores and acts on an unresolved P0 anomaly after boot pickup', async () => {
    const scheduler = createTestScheduler({ now: 100_000 })
    const actions: AutomatedAction[] = []
    const runtime = ManagedRuntime.make(
      Layer.merge(
        makeDeliveryEffectsLayer((command) =>
          Effect.sync(() => {
            actions.push(command.action)
            return { action: command.action, recordedAtMs: scheduler.now() }
          }),
        ),
        Layer.succeed(Clock.Clock, effectClock(scheduler)),
      ),
    )
    const flow = makeDeliveryFlow(runtime)
    const context: DeliveryContext = {
      tenantId: 'tenant-lakeshore',
      deliveryId: 'delivery-1',
      procedureState: 'assignment',
      severity: 'critical',
      anomalyOpenedAtMs: 0,
      score: 10,
      band: 'P0',
      lastActionBand: null,
      anomalyResolved: false,
    }
    const run = flow.create(context, { scheduler, instanceId: 'hydrated-delivery-run' })

    try {
      await run.start()
      await settle()
      await run.send('pickupConfirmed', { at: scheduler.now() })
      await settle()

      expect(actions).toEqual([
        'start_assignment',
        'emergency_stop',
        'page_dispatcher',
        'page_manager',
      ])
      expect(run.getState().context).toMatchObject({
        score: 10,
        band: 'P0',
        procedureState: 'operator_approval',
        lastActionBand: 'P0',
      })
      expect(run.getState().active).toContain('operatorApproval')
    } finally {
      run.dispose()
      await runtime.dispose()
    }
  })
})
