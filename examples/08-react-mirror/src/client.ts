/** Build the browser Mirror and hooks from the projection type. */
import { createMirror, type Mirror, type ProjectionOutput, type Transport } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { checkoutClient } from './flow'

export type ClientView = ProjectionOutput<typeof checkoutClient>

/** Step ids and actions are inferred from the projection. */
export const checkout = bindReact<typeof checkoutClient>()

export function createClient(transport: Transport<ClientView>): Mirror<typeof checkoutClient> {
  return createMirror<typeof checkoutClient>({ transport })
}
