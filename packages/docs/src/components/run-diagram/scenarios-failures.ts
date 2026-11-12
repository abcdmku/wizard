/** The runs the Handle failures page replays: retry, recovery by hand, fallback and undo. */
import { createTestScheduler } from '@openwizard/core/testing'
import { type TripDeps, trip } from '../../../snippets/learn/compensate'
import { price } from '../../../snippets/learn/fallback'
import { upload } from '../../../snippets/learn/retry'
import type { Scenario } from './record'
import { deferred } from './support'

const retrySucceeds: Scenario = {
  label: 'The third call succeeds',
  wizard: upload,
  async play(tape) {
    const scheduler = createTestScheduler()
    let calls = 0
    const run = upload.create(
      { fileId: 'f-1' },
      {
        scheduler,
        deps: {
          storage: {
            save: tape.service('storage.save', async (fileId: string) => {
              calls += 1
              if (calls < 3) throw new Error('storage is busy')
              return { url: `/files/${fileId}` }
            }),
          },
        },
      },
    )
    tape.track(run)
    await tape.beat(
      "const run = upload.create({ fileId: 'f-1' }, { deps })",
      'No step has started.',
    )
    await tape.beat(
      'await run.start()',
      'The first call throws. save has retries left, so it waits one second.',
      () => run.start(),
    )
    await tape.beat('// 1 second passes', 'The second call throws too. One retry is left.', () =>
      scheduler.advance(1_000),
    )
    await tape.beat(
      '// 1 second passes',
      'The third call succeeds. All three calls received the same idempotency key.',
      () => scheduler.advance(1_000),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

const retryHalts: Scenario = {
  label: 'Retries run out',
  wizard: upload,
  async play(tape) {
    const scheduler = createTestScheduler()
    let down = true
    const run = upload.create(
      { fileId: 'f-1' },
      {
        scheduler,
        deps: {
          storage: {
            save: tape.service('storage.save', async (fileId: string) => {
              if (down) throw new Error('storage is down')
              return { url: `/files/${fileId}` }
            }),
          },
        },
      },
    )
    tape.track(run)
    await tape.beat(
      "const run = upload.create({ fileId: 'f-1' }, { deps })",
      'No step has started.',
    )
    await tape.beat('await run.start()', 'The first call throws. save waits to retry.', () =>
      run.start(),
    )
    await tape.beat('// 1 second passes', 'The second call throws.', () => scheduler.advance(1_000))
    await tape.beat(
      '// 1 second passes',
      'The third call throws and no retries are left. The step fails and the run halts.',
      () => scheduler.advance(1_000),
    )
    await tape.beat(
      'await run.awaitOutcome()',
      'A halted run is waiting for you, not finished.',
      () => run.awaitOutcome(),
    )
    await tape.beat(
      "await run.retry('save') // after storage is back",
      'retry runs the step again with a fresh set of attempts.',
      () => {
        down = false
        return run.retry('save')
      },
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

const fallback: Scenario = {
  label: 'The live price is down',
  wizard: price,
  async play(tape) {
    const live = deferred<number>()
    const run = price.create(
      { sku: 'sku-1', listPrice: 10 },
      { deps: { live: { price: tape.service('live.price', (_sku: string) => live.promise) } } },
    )
    tape.track(run)
    await tape.beat(
      "const run = price.create({ sku: 'sku-1', listPrice: 10 }, { deps })",
      'No step has started.',
    )
    await tape.beat('await run.start()', 'live calls the pricing service.', () => run.start())
    await tape.beat(
      '// deps.live.price rejects',
      'live has no retries, so it is skipped and its fallback, list, starts. quote reads whichever step produced a value.',
      () => live.reject(new Error('pricing is down')),
    )
    await tape.beat('await run.awaitResult()', 'The run is done. It never halted.', () =>
      run.awaitResult(),
    )
    run.dispose()
  },
}

const compensate: Scenario = {
  label: 'The hotel is full',
  wizard: trip,
  async play(tape) {
    const hotel = deferred<{ ref: string }>()
    const cancel = deferred<void>()
    const deps: TripDeps = {
      flights: {
        book: tape.service('flights.book', async (_tripId: string) => ({ ref: 'FL-1' })),
        cancel: tape.service('flights.cancel', (_ref: string) => cancel.promise),
      },
      hotels: { book: tape.service('hotels.book', (_tripId: string) => hotel.promise) },
    }
    const run = trip.create({ tripId: 't-1' }, { deps })
    tape.track(run)
    await tape.beat("const run = trip.create({ tripId: 't-1' }, { deps })", 'No step has started.')
    await tape.beat('await run.start()', 'flight is booked. hotel is calling its service.', () =>
      run.start(),
    )
    await tape.beat(
      '// deps.hotels.book rejects',
      'hotel fails. The wizard sets onFailure to compensate, so the run undoes finished steps, newest first.',
      () => hotel.reject(new Error('hotel is full')),
    )
    await tape.beat(
      '// deps.flights.cancel resolves',
      'The flight is cancelled. The run ends as failed, with nothing left booked.',
      () => cancel.resolve(),
    )
    await tape.beat(
      'await run.awaitOutcome()',
      'The outcome reports the failure and how the undo went.',
      () => run.awaitOutcome(),
    )
    run.dispose()
  },
}

export const failureScenarios: Readonly<Record<string, readonly Scenario[]>> = {
  retry: [retrySucceeds, retryHalts],
  fallback: [fallback],
  compensate: [compensate],
}
