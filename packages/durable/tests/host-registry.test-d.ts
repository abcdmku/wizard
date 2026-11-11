import {
  createHostRegistry,
  type HostOpenContext,
  type HostOpenResult,
  type HostRegistryDisposed,
  type HostRegistryOpenResult,
} from '@openwizard/durable'
import { expectTypeOf } from 'vitest'

interface Identity {
  readonly tenant: string
  readonly request: number
}

interface Host {
  readonly tenant: string
  readonly close: () => void
}

interface OpenFailure {
  readonly ok: false
  readonly code: 'LEASE_BUSY'
  readonly retryAt: number
}

const openHost = async (
  identity: Identity,
  context: HostOpenContext,
): Promise<HostOpenResult<Host, OpenFailure>> => {
  expectTypeOf(context.signal).toEqualTypeOf<AbortSignal>()
  expectTypeOf(context.invalidate).toEqualTypeOf<() => void>()
  if (identity.request < 0) {
    return { ok: false, code: 'LEASE_BUSY', retryAt: 100 }
  }
  return {
    ok: true,
    value: { tenant: identity.tenant, close: () => undefined },
  }
}

const registry = createHostRegistry({
  key: (identity: Identity) => identity.tenant,
  open: openHost,
  close: (host: Host) => host.close(),
})

expectTypeOf(registry.open({ tenant: 'one', request: 1 })).toEqualTypeOf<
  Promise<HostRegistryOpenResult<Host, OpenFailure>>
>()
expectTypeOf(registry.cached({ tenant: 'one', request: 2 })).toEqualTypeOf<Host | undefined>()
expectTypeOf(registry.values()).toEqualTypeOf<readonly Host[]>()
expectTypeOf(
  registry.evict({ tenant: 'one', request: 3 }, { tenant: 'one', close: () => undefined }),
).toEqualTypeOf<Promise<boolean>>()
expectTypeOf(registry.dispose()).toEqualTypeOf<Promise<void>>()

declare const result: HostRegistryOpenResult<Host, OpenFailure>
if (!result.ok && result.code === 'HOST_REGISTRY_DISPOSED') {
  expectTypeOf(result).toEqualTypeOf<HostRegistryDisposed>()
}

// @ts-expect-error identities retain the inferred input type
registry.open({ tenant: 'one' })
// @ts-expect-error eviction requires the inferred host type
registry.evict({ tenant: 'one', request: 4 }, { id: 'wrong host' })

createHostRegistry({
  key: (identity: Identity) => identity.tenant,
  // @ts-expect-error opener failures must carry the false discriminant
  open: async () => ({ ok: true, code: 'LEASE_BUSY', retryAt: 100 }),
  close: (_host: Host) => undefined,
})
