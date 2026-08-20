import { createRun, type RunEvent } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { bookTripFlow, type Deps } from './book-trip'

/** Synchronous in-memory suppliers that record every call in order. */
function fakeSuppliers(options: { hotelCancelFailures?: number } = {}) {
  const log: string[] = []
  const state = { hotelCancelFailures: options.hotelCancelFailures ?? 0 }
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
  const run = createRun(bookTripFlow, { context: { tripId: 'T1', total: 900 }, deps })
  const events: RunEvent<typeof bookTripFlow>[] = []
  run.observe((event) => events.push(event))
  const eventsOfType = <T extends RunEvent['type']>(type: T) =>
    events.filter(
      (event): event is Extract<RunEvent<typeof bookTripFlow>, { type: T }> => event.type === type,
    )
  return { run, events, eventsOfType }
}

describe('03 compensation: onFailure "compensate"', () => {
  it('unwinds the three reservations in reverse completion order when the charge fails', async () => {
    const { deps, log } = fakeSuppliers()
    const { run, events, eventsOfType } = make(deps)

    // Everything is synchronous here: by the time start() resolves the saga has fully unwound.
    await run.start()
    expect(log).toEqual([
      'flights.reserve',
      'hotels.reserve',
      'cars.reserve',
      'payments.charge',
      'cars.cancel CAR-T1',
      'hotels.cancel H-T1',
      'flights.cancel PNR-T1',
    ])

    const state = run.getState()
    expect(state.status).toBe('failed')
    expect(state.steps.charge).toMatchObject({
      status: 'failed',
      error: { kind: 'run', message: 'card declined' },
    })
    for (const id of ['reserveFlight', 'reserveHotel', 'reserveCar'] as const)
      expect(state.steps[id].status).toBe('compensated')
    // The saga bookkeeping: what completed (with the output its compensate hook received) …
    expect(state.saga.stack.map((entry) => [entry.step, entry.output])).toEqual([
      ['reserveFlight', { pnr: 'PNR-T1' }],
      ['reserveHotel', { booking: 'H-T1' }],
      ['reserveCar', { rental: 'CAR-T1' }],
    ])
    // … and what was undone, in reverse completion order.
    expect(state.saga.compensated.map((entry) => entry.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(state.saga.failures).toEqual([])

    // The events: the plan is announced first, then one started/compensated pair per entry.
    expect(eventsOfType('flow.compensating')[0]).toMatchObject({
      plan: ['reserveCar', 'reserveHotel', 'reserveFlight'],
      outcome: 'failed',
    })
    expect(eventsOfType('step.compensationStarted').map((event) => event.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(eventsOfType('step.compensated').map((event) => event.step)).toEqual([
      'reserveCar',
      'reserveHotel',
      'reserveFlight',
    ])
    expect(eventsOfType('flow.compensated')[0]).toMatchObject({ failures: [], outcome: 'failed' })
    const types = events.map((event) => event.type)
    expect(types.indexOf('step.failed')).toBeLessThan(types.indexOf('flow.compensating'))
    expect(types.indexOf('flow.compensating')).toBeLessThan(
      types.indexOf('step.compensationStarted'),
    )
    expect(types.at(-1)).toBe('flow.compensated')

    // A compensated flow is terminal: every further command is rejected as a value.
    expect(run.explain('charge')).toMatchObject({
      status: 'failed',
      reasons: ['flow-terminal', 'failed:run'],
    })
    expect(await run.retry('charge')).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    expect(await run.next()).toMatchObject({ ok: false })
    run.dispose()
  })

  it('records a compensation failure, continues unwinding, and retries only the selected hook', async () => {
    const { deps, log } = fakeSuppliers({ hotelCancelFailures: 1 })
    const { run, events, eventsOfType } = make(deps)
    await run.start()

    // The hotel cancellation threw; the unwind continued with the flight.
    expect(log.slice(4)).toEqual([
      'cars.cancel CAR-T1',
      'hotels.cancel H-T1 FAILED',
      'flights.cancel PNR-T1',
    ])
    expect(run.getState().steps.reserveHotel).toMatchObject({
      status: 'failed',
      error: { kind: 'compensate', message: 'hotel desk offline' },
    })
    expect(run.getState().saga.failures).toEqual([{ step: 'reserveHotel', runId: 1 }])
    expect(eventsOfType('step.compensationFailed')[0]).toMatchObject({
      step: 'reserveHotel',
      error: { message: 'hotel desk offline' },
    })
    expect(eventsOfType('flow.compensated')[0]).toMatchObject({
      failures: ['reserveHotel'],
      outcome: 'failed',
    })
    expect(run.getState().status).toBe('failed')

    // The hotel desk is back: re-attempt only the failed entry.
    events.length = 0
    expect(await run.compensate({ from: 'reserveHotel' })).toMatchObject({ ok: true })
    expect(log.at(-1)).toBe('hotels.cancel H-T1')
    expect(eventsOfType('step.compensationStarted').map((event) => event.step)).toEqual([
      'reserveHotel',
    ])
    expect(run.getState().steps.reserveHotel.status).toBe('compensated')
    expect(run.getState().saga.failures).toEqual([])
    expect(eventsOfType('flow.compensated')[0]).toMatchObject({ failures: [] })
    // Nothing left to compensate → terminal for further compensate commands too.
    expect(await run.compensate({ from: 'reserveCar' })).toMatchObject({
      ok: false,
      code: 'FLOW_TERMINAL',
    })
    run.dispose()
  })
})
