import { describe, expect, it } from 'vitest'
import type { Delivery, Escalation } from '../model'
import { hasColdChainBreach, sortEscalations } from './dispatch'

const baseEscalation: Escalation = {
  id: 'esc-base',
  deliveryId: 'delivery-1',
  kind: 'delay',
  severity: 'medium',
  score: 5,
  band: 'P2',
  createdAt: '2026-08-23T12:00:00.000Z',
  title: 'Late arrival',
  detail: 'The route is behind plan.',
  allowedActions: ['contact_driver'],
}

const coldDelivery: Delivery = {
  id: 'delivery-1',
  reference: 'LS-1042',
  status: 'in_transit',
  customer: 'County Hospital',
  origin: 'Cold storage',
  destination: 'Receiving dock',
  eta: '2026-08-23T14:00:00.000Z',
  cargo: {
    label: 'Vaccines',
    coldChain: true,
    tempC: 9,
    minC: 2,
    maxC: 8,
  },
  procedure: [],
}

describe('sortEscalations', () => {
  it('uses score, severity, age, and id for a stable priority order', () => {
    const sorted = sortEscalations([
      { ...baseEscalation, id: 'medium-6', score: 6, band: 'P1' },
      { ...baseEscalation, id: 'critical-b', severity: 'critical', score: 8, band: 'P0' },
      { ...baseEscalation, id: 'critical-a', severity: 'critical', score: 8, band: 'P0' },
      { ...baseEscalation, id: 'high-6', severity: 'high', score: 6, band: 'P1' },
    ])

    expect(sorted.map((item) => item.id)).toEqual([
      'critical-a',
      'critical-b',
      'high-6',
      'medium-6',
    ])
  })

  it('does not let severity outrank the computed policy score', () => {
    const sorted = sortEscalations([
      { ...baseEscalation, id: 'medium-3', score: 3 },
      { ...baseEscalation, id: 'low-4', severity: 'low', score: 4 },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['low-4', 'medium-3'])
  })
})

describe('hasColdChainBreach', () => {
  it('flags temperatures outside the projected safe range', () => {
    expect(hasColdChainBreach(coldDelivery)).toBe(true)
    expect(
      hasColdChainBreach({
        ...coldDelivery,
        cargo: { ...coldDelivery.cargo, tempC: 4 },
      }),
    ).toBe(false)
  })
})
