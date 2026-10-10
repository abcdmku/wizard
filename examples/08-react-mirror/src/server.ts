/**
 * The "server" — everything a real backend would own: the wizard instance, the deps, and the
 * Mirror source. It runs IN THE PAGE here so the example is self-contained; in production this
 * file lives on the server, `createLocalTransport` is replaced by an SSE/WS/HTTP transport
 * (frames out via `source.subscribe`, commands in via `source.dispatch` after auth), and the
 * UI never imports it.
 */
import {
  createMirrorSource,
  createWizard,
  type Scheduler,
  type Transport,
  type Wizard,
} from '@openwizard/core'
import { createLocalTransport } from '@openwizard/core/testing'
import type { ClientView } from './client'
import { type CheckoutDeps, checkout, checkoutClient } from './flow'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Fake services with visible latency; `reserve` fails once to show the retry counter. */
export const demoDeps: CheckoutDeps = {
  inventory: {
    reserve: (() => {
      let calls = 0
      return async (cartId: string) => {
        await wait(900)
        calls += 1
        if (calls === 1) throw new Error('warehouse timeout (simulated, retried automatically)')
        return { reservationId: `rsv_${cartId}_${calls}` }
      }
    })(),
  },
  payments: {
    charge: async (token, amount) => {
      await wait(1200)
      return { chargeId: `ch_${token}_${Math.round(amount * 100)}` }
    },
  },
}

export interface ServerOptions {
  /** Services (default: the demo fakes with latency and one simulated failure). */
  readonly deps?: CheckoutDeps
  /** Loopback latency per hop in ms (default 120; the test uses 0). */
  readonly delayMs?: number
  /** Timers for retries (default: the real clock). */
  readonly scheduler?: Scheduler
}

/**
 * Start the wizard and return the client-facing transport (plus the wizard, for the host).
 * `serialize: true` JSON-round-trips every frame/command/ack and `delayMs` adds latency, so the
 * loopback behaves like a network.
 */
export function startServer(options: ServerOptions = {}): {
  readonly transport: Transport<ClientView>
  readonly wizard: Wizard<typeof checkout>
} {
  const wizard = createWizard(checkout, {
    context: { cartId: 'cart-42', total: 129.5 },
    deps: options.deps ?? demoDeps,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
  })
  void wizard.start()
  const source = createMirrorSource(wizard, checkoutClient)
  const transport = createLocalTransport(source, {
    delayMs: options.delayMs ?? 120,
    serialize: true,
  })
  return { transport, wizard }
}
