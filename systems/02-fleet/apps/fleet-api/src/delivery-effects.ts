import { Context, type Effect, Layer } from 'effect'
import type { ActionCommand, ActionFailure, ActionReceipt } from './delivery-model'

export interface DeliveryEffectsShape {
  readonly perform: (command: ActionCommand) => Effect.Effect<ActionReceipt, ActionFailure>
}

export class DeliveryEffects extends Context.Service<DeliveryEffects, DeliveryEffectsShape>()(
  'fleet/DeliveryEffects',
) {}

export function makeDeliveryEffectsLayer(
  perform: DeliveryEffectsShape['perform'],
): Layer.Layer<DeliveryEffects> {
  return Layer.succeed(DeliveryEffects)({ perform })
}
