import type { Dashboard, Viewer } from '@openwizard/fleet-shared'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeProjectedDashboard } from '../src/dashboard-projection'

const viewer: Viewer = { tenantId: 'tenant-lakeshore', role: 'dispatcher' }
const dashboard: Dashboard = {
  tenant: { id: 'tenant-lakeshore', name: 'Lakeshore', timezone: 'America/Chicago' },
  generatedAt: '2026-08-23T12:00:00.000Z',
  cursor: 4,
  vehicles: [],
  deliveries: [
    {
      id: 'delivery-1',
      reference: 'LS-1',
      status: 'in_transit',
      customer: 'Hospital',
      origin: 'Depot',
      destination: 'Hospital',
      eta: '2026-08-23T13:00:00.000Z',
      cargo: { label: 'Vaccines', coldChain: true, tempC: 12, minC: 2, maxC: 8 },
      procedure: [{ id: 'monitor', label: 'Monitor cargo', status: 'active' }],
    },
  ],
  escalations: [],
}

describe('projected fleet dashboard', () => {
  it('overlays live Wizard score, band, actions, and procedure state', async () => {
    const load = () => Effect.succeed(dashboard)
    const project = () =>
      Effect.succeed({
        deliveryId: 'delivery-1',
        version: { epoch: 2, seq: 7 },
        procedureState: 'dispatcher_intervention' as const,
        anomalyResolved: false,
        severity: 'critical' as const,
        anomalyOpenedAtMs: 0,
        score: 7,
        band: 'P1' as const,
      })
    const result = await Effect.runPromise(
      makeProjectedDashboard(load, project, () => 5_000)(viewer),
    )

    expect(result.deliveries[0]).toMatchObject({
      status: 'delayed',
      version: { epoch: 2, seq: 7 },
      procedure: [{ detail: 'Wizard state: dispatcher_intervention' }],
    })
    expect(result.escalations[0]).toMatchObject({
      deliveryId: 'delivery-1',
      severity: 'critical',
      score: 8,
      band: 'P0',
      allowedActions: ['contact_driver', 'hold', 'cancel'],
    })
  })

  it('removes a resolved escalation from the live read model', async () => {
    const seeded = {
      ...dashboard,
      escalations: [
        {
          id: 'escalation-1',
          deliveryId: 'delivery-1',
          kind: 'cold_chain',
          severity: 'critical' as const,
          score: 10,
          band: 'P0' as const,
          createdAt: dashboard.generatedAt,
          title: 'Breach',
          detail: 'Resolved',
          allowedActions: ['cancel' as const],
        },
      ],
    }
    const result = await Effect.runPromise(
      makeProjectedDashboard(
        () => Effect.succeed(seeded),
        () =>
          Effect.succeed({
            deliveryId: 'delivery-1',
            version: { epoch: 2, seq: 8 },
            procedureState: 'transit' as const,
            anomalyResolved: true,
          }),
        () => 5_000,
      )(viewer),
    )

    expect(result.escalations).toEqual([])
    expect(result.deliveries[0]?.status).toBe('in_transit')
  })
})
