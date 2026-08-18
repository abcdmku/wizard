/**
 * The client — the only OpenWizard objects the UI touches: a `Mirror` typed by the projection
 * (TYPE-ONLY import of `checkoutClient`, so no flow code, Zod schema or service reaches the
 * bundle) and the React binding derived from that type. Swap `transport` for an SSE/WS
 * transport in production; nothing else changes.
 */
import { createMirror, type Mirror, type ProjectionOutput, type Transport } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { checkoutClient } from './flow'

/** What the client sees: the projected `ClientState` of the checkout flow. */
export type ClientView = ProjectionOutput<typeof checkoutClient>

/** Typed hooks: `ow.useStep('shipping')` is checked against the flow; `'typo'` will not compile. */
export const ow = bindReact<typeof checkoutClient>()

export function createClient(transport: Transport<ClientView>): Mirror<typeof checkoutClient> {
  return createMirror<typeof checkoutClient>({ transport })
}
