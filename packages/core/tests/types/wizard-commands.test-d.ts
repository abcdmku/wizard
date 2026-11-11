import { describe, expectTypeOf, it } from 'vitest'
import type { Command as MachineCommand } from '../../src/machine/commands'
import type { Command, Run } from '../../src/wizard/create-wizard'
import { parseCommand } from '../../src/wizard/parse-command'
import { type CheckoutF, checkoutFlow } from './wizard-fixture'

declare const run: Run<CheckoutF>
declare const untrusted: unknown
declare function cmd(command: Command<CheckoutF>): void
declare function child<const P extends readonly [string, ...string[]], const C>(
  path: P,
  command: C,
): { readonly type: 'child'; readonly path: P; readonly command: C }

describe('typed wire commands', () => {
  it('Command<F> types every id: go/setInput/resetInput views, startStep/retry steps, send events, compensate.from steps', () => {
    const go: Command<CheckoutF> = { type: 'go', step: 'shipping' }
    expectTypeOf(go).toMatchTypeOf<Command>()
    cmd({ type: 'startStep', step: 'reserve' })
    cmd({ type: 'startReady' })
    // @ts-expect-error the removed run command has no compatibility alias
    cmd({ type: 'run', step: 'reserve' })
    // @ts-expect-error the removed runReady command has no compatibility alias
    cmd({ type: 'runReady' })
    // @ts-expect-error `go` rejects a non-view id
    cmd({ type: 'go', step: 'reserve' })
    // @ts-expect-error `go` rejects an unknown id
    cmd({ type: 'go', step: 'typo' })
    // @ts-expect-error `retry` rejects a non-task id
    cmd({ type: 'retry', step: 'shipping' })
    // @ts-expect-error `startStep` rejects an unknown id
    cmd({ type: 'startStep', step: 'typo' })
    // @ts-expect-error `send` rejects an unknown event
    cmd({ type: 'send', event: 'nope', payload: {} })
    // @ts-expect-error `compensate.from` is a step id
    cmd({ type: 'compensate', from: 'typo' })
    // `send.payload` stays unknown (re-parsed by the event boundary at runtime).
    cmd({ type: 'send', event: 'payment.captured', payload: 42 })
    // @ts-expect-error `sendRejected` is internal: not a wire command
    cmd({ type: 'sendRejected', event: 'payment.captured', issues: [] })
    // `skip` / `invalidate` take any step id of the flow.
    cmd({ type: 'skip', step: 'reserve', reason: 'ops' })
    cmd({ type: 'invalidate', step: 'shipping', cascade: false })
    // @ts-expect-error `skip.step` must be a step id
    cmd({ type: 'skip', step: 'typo' })
    // @ts-expect-error `invalidate.step` must be a step id
    cmd({ type: 'invalidate', step: 'typo' })
    // @ts-expect-error `cascade` is a boolean
    cmd({ type: 'invalidate', step: 'reserve', cascade: 'yes' })
  })
  it('setInput is correlated: the patch is the DraftOf of THAT view', () => {
    cmd({ type: 'setInput', step: 'shipping', patch: { address: 'x', express: true } })
    // @ts-expect-error wrong draft shape for `shipping`
    cmd({ type: 'setInput', step: 'shipping', patch: { address: 1 } })
    // @ts-expect-error unknown draft key
    cmd({ type: 'setInput', step: 'shipping', patch: { nope: 1 } })
    // @ts-expect-error `setInput` rejects a non-view id
    cmd({ type: 'setInput', step: 'reserve', patch: {} })
    // Inside a child command the patch is the CHILD view's draft.
    cmd(child(['fulfil'], { type: 'setInput', step: 'confirm', patch: { ok: true } }))
    // @ts-expect-error `ok` is a boolean in the child's draft
    cmd(child(['fulfil'], { type: 'setInput', step: 'confirm', patch: { ok: 'yes' } }))
  })
  it('child commands are typed by the child flow at the end of the path (single hop, nested and flattened)', () => {
    cmd(child(['fulfil'], { type: 'go', step: 'confirm' }))
    cmd(child(['fulfil'], { type: 'child', path: ['pack'], command: { type: 'go', step: 'pick' } }))
    cmd(child(['fulfil', 'pack'], { type: 'setInput', step: 'pick', patch: { bin: 'b1' } }))
    // @ts-expect-error `path[0]` must be a flow step
    cmd(child(['shipping'], { type: 'next' }))
    // @ts-expect-error `path[0]` must exist
    cmd(child(['typo'], { type: 'next' }))
    // @ts-expect-error the second segment must be a flow step of the child
    cmd(child(['fulfil', 'confirm'], { type: 'next' }))
    // @ts-expect-error the nested command is typed by the child (`shipping` is not a view of `fulfilment`)
    cmd(child(['fulfil'], { type: 'go', step: 'shipping' }))
    // @ts-expect-error … and the flattened form is typed by the grandchild
    cmd(child(['fulfil', 'pack'], { type: 'go', step: 'confirm' }))
    // @ts-expect-error a child command's path is never empty
    cmd({ type: 'child', path: [], command: { type: 'next' } })
  })
  it('dispatch() is typed by the flow; the untrusted door is parseCommand(flow, unknown) → Command<F> (no cast)', () => {
    // @ts-expect-error unknown view id
    run.dispatch({ type: 'go', step: 'typo' })
    // @ts-expect-error unknown event
    run.dispatch({ type: 'send', event: 'nope', payload: {} })
    // @ts-expect-error non-task id
    run.dispatch({ type: 'retry', step: 'shipping' })
    // @ts-expect-error wrong patch
    run.dispatch({ type: 'setInput', step: 'shipping', patch: { address: 1 } })
    // @ts-expect-error a raw machine command (string ids) is not a Command<F>
    run.dispatch({} as MachineCommand)
    const parsed = parseCommand(checkoutFlow, untrusted)
    if (parsed.ok) {
      expectTypeOf(parsed.value).toEqualTypeOf<Command<CheckoutF>>()
      run.dispatch(parsed.value)
    } else {
      expectTypeOf(parsed.issues[0]?.message).toEqualTypeOf<string | undefined>()
    }
    // Every typed command is a valid machine command (what the runtime consumes).
    expectTypeOf<Command<CheckoutF>>().toMatchTypeOf<MachineCommand>()
    expectTypeOf<Command>().toMatchTypeOf<MachineCommand>()
  })
})
