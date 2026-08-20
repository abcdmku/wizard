import { boundary, type Command, defineFlow } from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import {
  createDurableRun,
  type DurableCommandResult,
  type DurableEventResult,
  type DurableRunHost,
  type DurableRunOpenResult,
  type DurableStore,
  type Version,
} from '../src'

const durableTypeTest = defineFlow({
  name: 'durable-type-test',
  context: boundary.trusted<{ readonly n: number }>(),
  events: { ping: boundary.trusted<{ readonly n: number }>() },
})
const flow = durableTypeTest.steps({
  wait: durableTypeTest.wait({ on: { ping: () => ({ keep: true }) } }),
  done: durableTypeTest.final(),
})

declare const store: DurableStore
const opened = createDurableRun(flow, {
  context: { n: 0 },
  key: 'run',
  ownerId: 'owner',
  store,
})
expectTypeOf(opened).toEqualTypeOf<Promise<DurableRunOpenResult<typeof flow>>>()

declare const host: DurableRunHost<typeof flow>
const command: Command<typeof flow> = { type: 'start' }
expectTypeOf(host.dispatch(command, { commandId: 'command' })).toEqualTypeOf<
  Promise<DurableCommandResult>
>()
expectTypeOf(host.send('ping', { n: 1 }, { eventId: 'event' })).toEqualTypeOf<
  Promise<DurableEventResult>
>()
const expected: Version = host.version
expectTypeOf(
  host.dispatch(command, { commandId: 'command-2', expectedVersion: expected }),
).toEqualTypeOf<Promise<DurableCommandResult>>()

// @ts-expect-error durable commands require a caller-supplied id
host.dispatch(command, {})
// @ts-expect-error event ids are not event names
host.send('missing', {}, { eventId: 'event-2' })
