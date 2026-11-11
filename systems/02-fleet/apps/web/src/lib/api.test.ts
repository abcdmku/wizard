import { afterEach, describe, expect, it, vi } from 'vitest'

const dashboard = {
  tenant: {
    id: 'tenant-lakeshore',
    name: 'Lakeshore Logistics',
    timezone: 'America/Chicago',
  },
  generatedAt: '2026-08-23T12:00:00.000Z',
  cursor: 9,
  vehicles: [],
  deliveries: [],
  escalations: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('sendIntervention', () => {
  it('sends the projected delivery version as the compare-and-swap fence', async () => {
    vi.stubGlobal('window', {})
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ accepted: true, dashboard }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { sendIntervention } = await import('./api')

    await sendIntervention(
      'fleet-demo-lakeshore',
      'delivery-1',
      'hold',
      'command-1',
      'Awaiting dock clearance',
      { epoch: 4, seq: 17 },
    )

    const body = fetchMock.mock.calls.at(0)?.[1]?.body
    if (typeof body !== 'string') throw new Error('Expected a serialized intervention body')
    const parsedBody: unknown = JSON.parse(body)
    expect(parsedBody).toEqual({
      action: 'hold',
      commandId: 'command-1',
      expectedVersion: { epoch: 4, seq: 17 },
      reason: 'Awaiting dock clearance',
    })
  })
})
