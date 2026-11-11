import {
  boundary,
  type Ctx,
  type DepsOf,
  defineProjection,
  type ErrorOf,
  type OutputOf,
  type ProjectionOutput,
  type ProjectionScope,
  type RequiredDepsOf,
} from '@openwizard/core'
import type { EffectDeps } from '@openwizard/effect'
import type { Viewer } from '@openwizard/fleet-shared'
import { Effect, ManagedRuntime } from 'effect'
import { expectTypeOf } from 'vitest'
import { type DeliveryEffects, makeDeliveryEffectsLayer } from '../src/delivery-effects'
import { makeDeliveryFlow } from '../src/delivery-flow'
import type { ActionCommand, ActionReceipt, DeliveryContext } from '../src/delivery-model'

const runtime = ManagedRuntime.make(
  makeDeliveryEffectsLayer((command: ActionCommand) =>
    Effect.succeed<ActionReceipt>({ action: command.action, recordedAtMs: 0 }),
  ),
)
const deliveryFlow = makeDeliveryFlow(runtime)
expectTypeOf<Ctx<typeof deliveryFlow>>().toEqualTypeOf<DeliveryContext>()
expectTypeOf<OutputOf<typeof deliveryFlow, 'assignment'>>().toEqualTypeOf<ActionReceipt>()
expectTypeOf<ErrorOf<typeof deliveryFlow, 'assignment'>>().toEqualTypeOf<{
  code: string
  message: string
}>()
expectTypeOf<DepsOf<typeof deliveryFlow>>().toEqualTypeOf<EffectDeps<DeliveryEffects>>()
expectTypeOf<RequiredDepsOf<typeof deliveryFlow>>().toEqualTypeOf<{}>()

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
