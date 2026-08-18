import { createWizard, type WizardEvent } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { bookTrip, type Deps } from './book-trip'

/** Synchronous in-memory suppliers that record every call in order. */
function fakeSuppliers(opts: { hotelCancelFailures?: number } = {}) {
  const log: string[] = []
  const state = { hotelCancelFailures: opts.hotelCancelFailures ?? 0 }
  const deps: Deps = {
    flights: {
      reserve: (trip) => {
        log.push('flights.reserve')
        return { pnr: `PNR-${trip}` }
      },
      cancel: (pnr) => void log.push(`flights.cancel ${pnr}`),
    },
    hotels: {
      reserve: (trip) => {
        log.push('hotels.reserve')
        return { booking: `H-${trip}` }
      },
      cancel: (booking) => {
        if (state.hotelCancelFailures > 0) {
          state.hotelCancelFailures -= 1
          log.push(`hotels.cancel ${booking} FAILED`)
          throw new Error('hotel desk offline')
        }
        log.push(`hotels.cancel ${booking}`)
      },
    },
    cars: {
      reserve: (trip) => {
        log.push('cars.reserve')
        return { rental: `CAR-${trip}` }
      },
      cancel: (rental) => void log.push(`cars.cancel ${rental}`),
    },
    payments: {
      charge: () => {
        log.push('payments.charge')
        throw new Error('card declined')
      },
    },
  }
  return { deps, log, state }
}

function make(deps: Deps) {
  const wizard = createWizard(bookTrip, { context: { tripId: 'T1', total: 900 }, deps })
  const events: WizardEvent<typeof bookTrip>[] = []
  wizard.observe((e) => events.push(e))
  const of = <T extends WizardEvent['type']>(type: T) =>
    events.filter((e): e is Extract<WizardEvent<typeof bookTrip>, { type: T }> => e.type === type)
  return { wizard, events, of }
}

describe('03 compensation: onFailure "compensate"', () => {
  it('unwinds the three reservations in reverse completion order when the charge fails', async () => {
    const { deps, log } = fakeSuppliers()
    const { wizard, events, of } = make(deps)

    // Everything is synchronous here: by the time start() resolves the saga has fully unwound.
    await wizard.start()
    expect(log).toEqual([
      'flights.reserve',
      'hotels.reserve',
      'cars.reserve',
      'payments.charge',
      'cars.cancel CAR-T1',
      'hotels.cancel H-T1',
      'flights.cancel PNR-T1',
    ])

    const state = wizard.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.charge).toMatchObject({
      status: 'failed',
      error: { kind: 'run', message: 'card declined' },
    })
    for (const id of ['reserveFlight', 'reserveHotel', 'reserveCar'] as const)
      expect(state.steps[id].status).toBe('compensated')
    // The saga bookkeeping: what completed (with the output its compensate hook received) …
    expect(state.saga.stack.map((e) => [e.step, e.output])).toEqual([
      ['reserveFlight', { pnr: 'PNR-T1' }],
      ['reserveHotel', { booking: 'H-T1' }],
      ['reserveCar', { rental: 'CAR-T1' }],
    ])
    // … and what was undone, in reverse completion order.
    expect(state.saga.compensated.map((e) => e.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(state.saga.failures).toEqual([])

    // The events: the plan is announced first, then one started/compensated pair per entry.
    expect(of('flow.compensating')[0]).toMatchObject({
      plan: ['reserveCar', 'reserveHotel', 'reserveFlight'],
      outcome: 'failed',
    })
    expect(of('step.compensationStarted').map((e) => e.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(of('step.compensated').map((e) => e.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(of('flow.compensated')[0]).toMatchObject({ failures: [], outcome: 'failed' })
    const types = events.map((e) => e.type)
    expect(types.indexOf('step.failed')).toBeLessThan(types.indexOf('flow.compensating'))
    expect(types.indexOf('flow.compensating')).toBeLessThan(
      types.indexOf('step.compensationStarted'),
    )
    expect(types.at(-1)).toBe('flow.compensated')

    // A compensated flow is terminal: every further command is rejected as a value.
    expect(wizard.explain('charge')).toMatchObject({
      status: 'failed',
      reasons: ['flow-terminal', 'failed:run'],
    })
    expect(await wizard.retry('charge')).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    expect(await wizard.next()).toMatchObject({ ok: false })
    wizard.dispose()
  })

  it('records a throwing compensate hook in saga.failures, keeps unwinding, and compensate({ from }) re-attempts only it', async () => {
    const { deps, log } = fakeSuppliers({ hotelCancelFailures: 1 })
    const { wizard, events, of } = make(deps)
    await wizard.start()

    // The hotel cancellation threw; the unwind continued with the flight.
    expect(log.slice(4)).toEqual([
      'cars.cancel CAR-T1',
      'hotels.cancel H-T1 FAILED',
      'flights.cancel PNR-T1',
    ])
    expect(wizard.getState().steps.reserveHotel).toMatchObject({
      status: 'failed',
      error: { kind: 'compensate', message: 'hotel desk offline' },
    })
    expect(wizard.getState().saga.failures).toEqual([{ step: 'reserveHotel', runId: 1 }])
    expect(of('step.compensationFailed')[0]).toMatchObject({
      step: 'reserveHotel',
      error: { message: 'hotel desk offline' },
    })
    expect(of('flow.compensated')[0]).toMatchObject({
      failures: ['reserveHotel'],
      outcome: 'failed',
    })
    expect(wizard.getState().status).toBe('failed')

    // The hotel desk is back: re-attempt only the failed entry.
    events.length = 0
    expect(await wizard.compensate({ from: 'reserveHotel' })).toMatchObject({ ok: true })
    expect(log.at(-1)).toBe('hotels.cancel H-T1')
    expect(of('step.compensationStarted').map((e) => e.step)).toEqual(['reserveHotel'])
    expect(wizard.getState().steps.reserveHotel.status).toBe('compensated')
    expect(wizard.getState().saga.failures).toEqual([])
    expect(of('flow.compensated')[0]).toMatchObject({ failures: [] })
    // Nothing left to compensate → terminal for further compensate commands too.
    expect(await wizard.compensate({ from: 'reserveCar' })).toMatchObject({
      ok: false,
      code: 'FLOW_TERMINAL',
    })
    wizard.dispose()
  })
})
