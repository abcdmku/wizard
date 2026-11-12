import type { Viewer } from '@openwizard/fleet-shared'
import { Effect, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeDeliveryEffectsLayer } from '../src/delivery-effects'
import type { ActionCommand, ActionReceipt, DeliveryContext } from '../src/delivery-model'
import { makeDeliveryWizard } from '../src/delivery-wizard'
import { makeDeliveryDispatchProjection } from '../src/dispatch-projection'

const context: DeliveryContext = {
  tenantId: 'tenant-lakeshore',
  deliveryId: 'delivery-1',
  procedureState: 'assignment',
  anomalyResolved: false,
}

describe('fleet scoped projections', () => {
  it('serializes only selected state and keeps the principal outside the wire projection', async () => {
    const runtime = ManagedRuntime.make(
      makeDeliveryEffectsLayer((command: ActionCommand) =>
        Effect.succeed<ActionReceipt>({ action: command.action, recordedAtMs: 0 }),
      ),
    )
    const wizard = makeDeliveryWizard(runtime)
    const run = wizard.create(context, { instanceId: 'projection-run' })
    const projection = makeDeliveryDispatchProjection(wizard)

    for (const role of ['dispatcher', 'manager'] as const) {
      const viewer: Viewer = { tenantId: 'tenant-lakeshore', role }
      const projected = run.project(projection, viewer)
      expect(projected).toEqual({
        deliveryId: 'delivery-1',
        procedureState: 'assignment',
        anomalyResolved: false,
      })
      expect(JSON.parse(JSON.stringify(projected))).toEqual(projected)
      expect(JSON.stringify(projected)).not.toContain(role)
      expect(JSON.stringify(projected)).not.toContain('tenant-lakeshore')
    }
    for (const role of ['simulator', 'seed'] as const) {
      expect(run.project(projection, { tenantId: 'tenant-lakeshore', role })).toBeNull()
    }
    const foreignViewer: Viewer = { tenantId: 'tenant-redwood', role: 'dispatcher' }
    expect(run.project(projection, foreignViewer)).toBeNull()

    run.dispose()
    await runtime.dispose()
  })
})
