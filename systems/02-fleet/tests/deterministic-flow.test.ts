import { createTestScheduler } from '@openwizard/core/testing'
import { Effect, ManagedRuntime } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../apps/fleet-api/src/delivery-effects'
import { makeDeliveryFlow } from '../apps/fleet-api/src/delivery-flow'
import type {
  ActionCommand,
  ActionReceipt,
  DeliveryContext,
} from '../apps/fleet-api/src/delivery-model'

const settle = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function testRuntime(calls: ActionCommand[]) {
  return ManagedRuntime.make(
    makeDeliveryEffectsLayer((command) => {
      calls.push(command)
      const receipt: ActionReceipt = { action: command.action, recordedAtMs: 0 }
      return Effect.succeed(receipt)
    }),
  )
}

const context: DeliveryContext = {
  tenantId: 'tenant-lakeshore',
  deliveryId: 'delivery-1',
  procedureState: 'assignment',
  anomalyResolved: false,
}

describe('cold-chain delivery flow determinism', () => {
  it('runs the real delivery flow with the Wizard virtual scheduler', async () => {
    const calls: ActionCommand[] = []
    const runtime = testRuntime(calls)
    const flow = makeDeliveryFlow(runtime)
    const scheduler = createTestScheduler({ now: 10_000 })
    const run = flow.create(context, { scheduler })

    await run.start()
    await settle()
    expect(calls[0]?.action).toBe('start_assignment')
    expect(run.getState().steps.assignment.status).toBe('done')
    expect(run.getState().steps.pickup.status).toBe('active')

    scheduler.advance(30 * 60_000 - 1)
    await settle()
    expect(run.getState().steps.pickup.status).toBe('active')
    scheduler.advance(1)
    await settle()
    expect(run.getState().steps.operatorApproval.status).toBe('active')
    expect(run.getState().context.procedureState).toBe('operator_approval')

    run.dispose()
    await runtime.dispose()
  })

  it('uses Effect 4 TestClock for an Effect task without waiting in real time', async () => {
    const timestamp = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make()
          yield* clock.adjust('15 minutes')
          return clock.currentTimeMillisUnsafe()
        }),
      ),
    )
    expect(timestamp).toBe(15 * 60_000)
  })
})
