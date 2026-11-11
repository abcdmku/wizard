import { boundary, defineWizard } from '@openwizard/core'
import { expectTypeOf, test } from 'vitest'
import { instrumentRun } from '../src/index'

const wizard = defineWizard(
  {
    name: 'typed-events',
    context: boundary.trusted<{}>(),
    events: { paid: boundary.trusted<{ amount: number }>() },
  },
  ({ step, steps }) => steps({ wait: step({ waitFor: { paid: () => ({ done: true }) } }) }),
)

test('instrumentation send preserves the run event input contract', () => {
  const run = wizard.create({})
  const telemetry = instrumentRun(run)
  const unknownBody: unknown = { amount: 1 }
  expectTypeOf(telemetry.send('paid', { amount: 1 }, { eventId: 'payment-1' })).toEqualTypeOf<
    ReturnType<typeof run.send>
  >()
  telemetry.send('paid', unknownBody)
  // @ts-expect-error An instrumented event still requires its declared payload.
  telemetry.send('paid', { amount: '1' })
  // @ts-expect-error Event names belong to this wizard.
  telemetry.send('unknown', { amount: 1 })
  // @ts-expect-error Delivery ids are strings.
  telemetry.send('paid', { amount: 1 }, { eventId: 1 })
  telemetry.stop()
  run.dispose()
})
