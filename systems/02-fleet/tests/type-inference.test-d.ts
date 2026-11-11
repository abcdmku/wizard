import {
  boundary,
  type Command,
  type ContextInput,
  type Ctx,
  type DepsOf,
  defineProjection,
  type ErrorOf,
  type EventType,
  type InputOf,
  type OutputOf,
  type PayloadOf,
  type ProjectionOutput,
  type ProjectionScope,
  type RequiredDepsOf,
} from '@openwizard/core'
import type { EffectDeps } from '@openwizard/effect'
import type {
  Dashboard,
  DurableVersion,
  InterventionAction,
  InterventionRequest,
  LiveDispatchEvent,
  Viewer,
} from '@openwizard/fleet-shared'
import { Effect, ManagedRuntime } from 'effect'
import { expectTypeOf } from 'vitest'
import {
  type DeliveryEffects,
  makeDeliveryEffectsLayer,
} from '../apps/fleet-api/src/delivery-effects'
import { makeDeliveryFlow } from '../apps/fleet-api/src/delivery-flow'
import type {
  ActionCommand,
  ActionReceipt,
  DeliveryContext,
  InterventionEvent,
} from '../apps/fleet-api/src/delivery-model'

const runtime = ManagedRuntime.make(
  makeDeliveryEffectsLayer((command: ActionCommand) =>
    Effect.succeed<ActionReceipt>({ action: command.action, recordedAtMs: 0 }),
  ),
)
const deliveryFlow = makeDeliveryFlow(runtime)

expectTypeOf<ContextInput<typeof deliveryFlow>>().toEqualTypeOf<DeliveryContext>()
expectTypeOf<Ctx<typeof deliveryFlow>>().toEqualTypeOf<DeliveryContext>()
expectTypeOf<EventType<typeof deliveryFlow>>().toEqualTypeOf<
  | 'assigned'
  | 'pickupConfirmed'
  | 'telemetry'
  | 'arrived'
  | 'anomalyResolved'
  | 'intervention'
  | 'approval'
  | 'cancelled'
>()
expectTypeOf<PayloadOf<typeof deliveryFlow, 'intervention'>>().toEqualTypeOf<InterventionEvent>()
expectTypeOf<InputOf<typeof deliveryFlow, 'assignment'>>().toEqualTypeOf<never>()
expectTypeOf<OutputOf<typeof deliveryFlow, 'assignment'>>().toEqualTypeOf<ActionReceipt>()
expectTypeOf<ErrorOf<typeof deliveryFlow, 'assignment'>>().toEqualTypeOf<{
  code: string
  message: string
}>()
expectTypeOf<DepsOf<typeof deliveryFlow>>().toEqualTypeOf<EffectDeps<DeliveryEffects>>()
expectTypeOf<RequiredDepsOf<typeof deliveryFlow>>().toEqualTypeOf<{}>()
expectTypeOf<Command<typeof deliveryFlow>>().toMatchTypeOf<{ readonly type: string }>()

const scopedProjection = defineProjection(deliveryFlow, {
  scope: boundary.trusted<Viewer>(),
  select: ({ state, scope }) =>
    scope.tenantId.length > 0 ? { deliveryId: state.context.deliveryId } : { deliveryId: '' },
})
expectTypeOf<ProjectionScope<typeof scopedProjection>>().toEqualTypeOf<Viewer>()
expectTypeOf<ProjectionOutput<typeof scopedProjection>>().toMatchTypeOf<{
  readonly deliveryId: string
}>()
expectTypeOf<ProjectionOutput<typeof scopedProjection>>().not.toHaveProperty('tenantId')

expectTypeOf<Dashboard['deliveries'][number]['cargo']['tempC']>().toEqualTypeOf<
  number | undefined
>()
expectTypeOf<Dashboard['deliveries'][number]['version']>().toEqualTypeOf<
  DurableVersion | undefined
>()
expectTypeOf<InterventionAction>().toEqualTypeOf<
  'contact_driver' | 'reroute' | 'hold' | 'cancel' | 'complete'
>()
expectTypeOf<InterventionRequest['action']>().toEqualTypeOf<InterventionAction>()
expectTypeOf<InterventionRequest['commandId']>().toEqualTypeOf<string>()
expectTypeOf<InterventionRequest['reason']>().toEqualTypeOf<string | undefined>()
expectTypeOf<InterventionRequest['expectedVersion']>().toEqualTypeOf<
  { readonly epoch: number; readonly seq: number } | undefined
>()
expectTypeOf<InterventionRequest>().not.toHaveProperty('tenantId')
expectTypeOf<InterventionRequest>().not.toHaveProperty('scope')
expectTypeOf<LiveDispatchEvent['data']>().toEqualTypeOf<Dashboard>()
