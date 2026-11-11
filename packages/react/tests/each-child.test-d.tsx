import type { MirrorChild } from '@openwizard/core/mirror'
import { describe, expectTypeOf, it } from 'vitest'
import { bindReact } from '../src'
import type { approval, batch, batchClient, nested, nestedClient } from './each-child-fixture'

describe('indexed child binding types', () => {
  it('requires an index for mapped children and preserves the selected child types', () => {
    const run = bindReact<typeof batch>()
    const client = bindReact<typeof batchClient>()
    const child = run.useChild('batch', 1)
    const projected = client.useChild('batch', 1)
    expectTypeOf(child.useSnapshot()?.context.id).toEqualTypeOf<string | undefined>()
    expectTypeOf(projected.useSnapshot()?.context.id).toEqualTypeOf<string | undefined>()
    expectTypeOf(child.useStep('approval').output).toEqualTypeOf<string | undefined>()
    expectTypeOf(projected.useStep('approval').output).toEqualTypeOf<string | undefined>()
    expectTypeOf(child.useActions()).toEqualTypeOf<MirrorChild<typeof approval>>()
    expectTypeOf(projected.useActions()).toEqualTypeOf<MirrorChild<typeof approval>>()
    child.useActions().send('approved', { token: 'accepted' })
    projected.useActions().send('approved', { token: 'accepted' })
    // @ts-expect-error a mapped child needs its input index
    run.useChild('batch')
    // @ts-expect-error a mapped Mirror child needs its input index
    client.useChild('batch')
    // @ts-expect-error React child selection uses numeric input indices
    run.useChild('batch', 'one')
    // @ts-expect-error remote stable keys are not wire selectors
    client.useChild('batch', 'one')
    // @ts-expect-error the child event payload stays typed
    child.useActions().send('approved', { token: 1 })
    // @ts-expect-error the projected child event name stays typed
    projected.useActions().send('approvde', { token: 'accepted' })
  })

  it('keeps single children unindexed and requires selectors on nested maps', () => {
    const run = bindReact<typeof nested>()
    const client = bindReact<typeof nestedClient>()
    expectTypeOf(run.useChild('single').useSnapshot()?.context.id).toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf(client.useChild('single').useSnapshot()?.context.id).toEqualTypeOf<
      string | undefined
    >()
    run.useChild('nested').useChild('batch', 0).useActions().send('approved', { token: 'one' })
    client.useChild('nested').useChild('batch', 0).useActions().send('approved', { token: 'one' })
    // @ts-expect-error an ordinary child does not take an index
    run.useChild('single', 0)
    // @ts-expect-error an ordinary Mirror child does not take an index
    client.useChild('single', 0)
    // @ts-expect-error nested mapped child still requires an index
    run.useChild('nested').useChild('batch')
    // @ts-expect-error nested projected mapped child still requires an index
    client.useChild('nested').useChild('batch')
    // @ts-expect-error nested mapped Mirror child takes a numeric index
    client.useChild('nested').useChild('batch', '0')
  })
})
