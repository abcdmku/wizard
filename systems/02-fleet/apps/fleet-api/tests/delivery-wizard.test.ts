import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import type { Severity, VehicleTelemetry } from '@openwizard/fleet-shared'
import { Clock, Duration, Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../src/delivery-effects'
import type { ActionCommand, ActionReceipt, DeliveryContext } from '../src/delivery-model'
import type { DeliveryWizard } from '../src/delivery-wizard'
import { makeDeliveryWizard } from '../src/delivery-wizard'
import { runColdChainBreachDrill } from '../src/simulator'

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

interface Harness {
  readonly scheduler: TestScheduler
  readonly calls: ActionCommand[]
  readonly wizard: DeliveryWizard
  readonly run: import('@openwizard/core').Run<DeliveryWizard>
  readonly close: () => Promise<void>
}

function harness(): Harness {
  const scheduler = createTestScheduler({ now: 100_000 })
  const calls: ActionCommand[] = []
  const runtime = ManagedRuntime.make(
    Layer.merge(
      makeDeliveryEffectsLayer((command) =>
        Effect.sync(() => {
          calls.push(command)
          const receipt: ActionReceipt = { action: command.action, recordedAtMs: scheduler.now() }
          return receipt
        }),
      ),
      Layer.succeed(Clock.Clock, effectClock(scheduler)),
    ),
  )
  const wizard = makeDeliveryWizard(runtime)
  const context: DeliveryContext = {
    tenantId: 'tenant-lakeshore',
    deliveryId: 'delivery-1',
    procedureState: 'assignment',
    anomalyResolved: false,
  }
  const run = wizard.create(context, { scheduler, instanceId: 'delivery-run-1' })
  return {
    scheduler,
    calls,
    wizard,
    run,
    close: async () => {
      run.dispose()
      await runtime.dispose()
    },
  }
}

function telemetry(commandId: string, capturedAt: number, severity: Severity): VehicleTelemetry {
  return {
    commandId,
    capturedAt,
    position: { x: 12, y: 18, heading: 90 },
    batteryPercent: 80,
    tempC: 4,
    traffic: 'clear',
    fault: { code: `fault-${commandId}`, severity, detail: 'test fault' },
  }
}

async function start(h: Harness): Promise<void> {
  await h.run.start()
  await settle()
}

async function enterTransit(h: Harness): Promise<void> {
  await h.run.send('pickupConfirmed', { at: h.scheduler.now() })
  await settle()
}

async function enterDispatcherIntervention(
  h: Harness,
  severity: 'low' | 'medium' | 'high' | 'critical',
) {
  await enterTransit(h)
  await h.run.send('telemetry', telemetry(`telemetry-${severity}`, h.scheduler.now(), severity))
  await settle()
}

describe('fleet delivery workflow', () => {
  it('hands each score to its actions and its route through needs', async () => {
    const h = harness()
    try {
      const manifest = inspect(h.wizard)
      const needs = (id: string) =>
        Object.keys(manifest.nodes.find((node) => node.id === id)?.needs ?? {})
      expect(manifest.description).toContain('cold-chain delivery')
      expect(manifest.nodes.filter((node) => node.description === undefined)).toEqual([])
      expect(needs('actInitial')).toEqual(['score'])
      expect(needs('initialRoute')).toEqual(['score', 'receipts'])
      expect(needs('react')).toEqual(['score'])
      expect(needs('escalationRoute')).toEqual(['score', 'receipts'])
      expect(new Set(manifest.warnings.map((warning) => warning.code))).toEqual(
        new Set(['NAV_CYCLE']),
      )

      await start(h)
      await enterDispatcherIntervention(h, 'high')
      const first = h.run.getState().steps
      expect(first.scoreInitial.output).toMatchObject({ score: 5, band: 'P2' })
      expect(first.actInitial.output?.map((receipt) => receipt.action)).toEqual(['queue'])

      h.scheduler.advance(5_000)
      await settle()
      const second = h.run.getState().steps
      expect(second.rescore.output).toMatchObject({ score: 6, band: 'P1' })
      expect(second.react.output?.map((receipt) => receipt.action)).toEqual([
        'stop_assignments',
        'page_dispatcher',
      ])
      expect(h.run.getState().active).toContain('dispatcherIntervention')
    } finally {
      await h.close()
    }
  })

  it('keeps the pickup wait active when assignment metadata arrives', async () => {
    const h = harness()
    try {
      await start(h)
      await h.run.send('assigned', { vehicleId: 'vehicle-1', at: h.scheduler.now() })
      await settle()

      const state = h.run.getState()
      expect(state.active).toContain('pickup')
      expect(state.steps.pickup?.status).toBe('active')
      expect(state.context.vehicleId).toBe('vehicle-1')
      expect(h.calls.map((call) => call.action)).toEqual(['start_assignment'])
    } finally {
      await h.close()
    }
  })

  it('cancels from the pickup wait and records the cancellation state', async () => {
    const h = harness()
    try {
      await start(h)
      await h.run.send('cancelled', {
        commandId: 'cancel-1',
        at: h.scheduler.now(),
        reason: 'customer request',
      })
      await settle()

      expect(h.run.getState().context.procedureState).toBe('cancellation')
      expect(h.run.getState().status).toBe('cancelled')
      expect(h.run.result()).toMatchObject({ status: 'cancelled' })
    } finally {
      await h.close()
    }
  })

  it('recomputes immediately when the active anomaly changes severity', async () => {
    const h = harness()
    try {
      await start(h)
      await enterDispatcherIntervention(h, 'high')
      expect(h.run.getState().context).toMatchObject({ score: 5, band: 'P2' })

      const before = h.calls.length
      await h.run.send('telemetry', telemetry('telemetry-critical', h.scheduler.now(), 'critical'))
      await settle()

      const state = h.run.getState()
      expect(state.context).toMatchObject({ severity: 'critical', score: 7, band: 'P1' })
      expect(state.active).toContain('dispatcherIntervention')
      expect(h.calls.slice(before).map((call) => call.action)).toEqual([
        'stop_assignments',
        'page_dispatcher',
      ])
    } finally {
      await h.close()
    }
  })

  it('runs the escalation loop at exactly five seconds', async () => {
    const h = harness()
    try {
      await start(h)
      await enterDispatcherIntervention(h, 'high')
      const before = h.calls.length

      h.scheduler.advance(4_999)
      await settle()
      expect(h.calls.length).toBe(before)
      expect(h.run.getState().context).toMatchObject({ score: 5, band: 'P2' })

      h.scheduler.advance(1)
      await settle()
      expect(h.run.getState().context).toMatchObject({ score: 6, band: 'P1' })
      expect(h.calls.slice(before).map((call) => call.action)).toEqual([
        'stop_assignments',
        'page_dispatcher',
      ])
    } finally {
      await h.close()
    }
  })

  it('takes the P0 emergency route and performs every emergency action', async () => {
    const h = harness()
    try {
      await start(h)
      await enterDispatcherIntervention(h, 'critical')
      const before = h.calls.length

      h.scheduler.advance(5_000)
      await settle()

      const state = h.run.getState()
      expect(state.context).toMatchObject({
        score: 8,
        band: 'P0',
        procedureState: 'operator_approval',
      })
      expect(state.active).toContain('operatorApproval')
      expect(h.calls.slice(before).map((call) => call.action)).toEqual([
        'emergency_stop',
        'page_dispatcher',
        'page_manager',
      ])

      await h.run.send('approval', {
        commandId: 'manager-approval-1',
        approved: true,
        actorRole: 'manager',
        at: h.scheduler.now(),
      })
      await settle()
      expect(h.run.getState().active).toContain('postInterventionTransit')
      expect(h.run.getState().context).toMatchObject({
        anomalyResolved: true,
        procedureState: 'transit',
      })
    } finally {
      await h.close()
    }
  })

  it('records a denied manager approval as a cancellation outcome', async () => {
    const h = harness()
    try {
      await start(h)
      await enterDispatcherIntervention(h, 'critical')
      h.scheduler.advance(5_000)
      await settle()

      await h.run.send('approval', {
        commandId: 'manager-denial-1',
        approved: false,
        actorRole: 'manager',
        at: h.scheduler.now(),
      })
      await settle()

      expect(h.run.getState().context.procedureState).toBe('cancellation')
      expect(h.run.result()).toMatchObject({
        status: 'done',
        output: { state: 'cancellation' },
      })
    } finally {
      await h.close()
    }
  })

  it('publishes a clock-owned critical telemetry event for the cold-chain drill', async () => {
    const scheduler = createTestScheduler({ now: 250_000 })
    const published: VehicleTelemetry[] = []
    await Effect.runPromise(
      runColdChainBreachDrill(
        {
          publish: (_tenantId, _vehicleId, event) =>
            Effect.sync(() => {
              published.push(event)
            }),
        },
        'tenant-lakeshore',
        {
          deliveryId: 'delivery-1',
          vehicleId: 'vehicle-1',
          tempC: 12,
          commandId: 'cold-chain-drill-1',
        },
        {
          position: { x: 12, y: 18, heading: 90 },
          batteryPercent: 80,
          traffic: 'blocked',
        },
      ).pipe(Effect.provideService(Clock.Clock, effectClock(scheduler))),
    )

    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      commandId: 'cold-chain-drill-1',
      capturedAt: 250_000,
      tempC: 12,
      fault: { code: 'COLD_CHAIN_BREACH', severity: 'critical' },
    })
  })
})
