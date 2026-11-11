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
import type {
  ActionCommand,
  ActionReceipt,
  DeliveryContext,
  InterventionEvent,
} from '../apps/fleet-api/src/delivery-model'
import { makeDeliveryWizard } from '../apps/fleet-api/src/delivery-wizard'

const runtime = ManagedRuntime.make(
  makeDeliveryEffectsLayer((command: ActionCommand) =>
    Effect.succeed<ActionReceipt>({ action: command.action, recordedAtMs: 0 }),
  ),
)
const deliveryWizard = makeDeliveryWizard(runtime)

expectTypeOf<ContextInput<typeof deliveryWizard>>().toEqualTypeOf<DeliveryContext>()
expectTypeOf<Ctx<typeof deliveryWizard>>().toEqualTypeOf<DeliveryContext>()
expectTypeOf<EventType<typeof deliveryWizard>>().toEqualTypeOf<
  | 'assigned'
  | 'pickupConfirmed'
  | 'telemetry'
  | 'arrived'
  | 'anomalyResolved'
  | 'intervention'
  | 'approval'
  | 'cancelled'
>()
expectTypeOf<PayloadOf<typeof deliveryWizard, 'intervention'>>().toEqualTypeOf<InterventionEvent>()
expectTypeOf<InputOf<typeof deliveryWizard, 'assignment'>>().toEqualTypeOf<never>()
expectTypeOf<OutputOf<typeof deliveryWizard, 'assignment'>>().toEqualTypeOf<ActionReceipt>()
expectTypeOf<ErrorOf<typeof deliveryWizard, 'assignment'>>().toEqualTypeOf<{
  code: string
  message: string
}>()
expectTypeOf<DepsOf<typeof deliveryWizard>>().toEqualTypeOf<EffectDeps<DeliveryEffects>>()
expectTypeOf<RequiredDepsOf<typeof deliveryWizard>>().toEqualTypeOf<{}>()
expectTypeOf<Command<typeof deliveryWizard>>().toMatchTypeOf<{ readonly type: string }>()

const scopedProjection = defineProjection(deliveryWizard, {
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
