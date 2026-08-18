import { createWizard, isWizardError, parseCommand, type WizardEvent } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { type Deps, fulfilment, order } from './order'

function fakeDeps() {
  const shipments: Array<[orderId: string, warehouse: string]> = []
  const deps: Deps = {
    payments: { charge: (orderId) => ({ chargeId: `ch_${orderId}` }) },
    carrier: {
      ship: async (orderId, warehouse) => {
        shipments.push([orderId, warehouse])
        return { tracking: `TRK-${warehouse.toUpperCase()}-${orderId}` }
      },
    },
  }
  return { deps, shipments }
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

describe('06 nested flow: s.flow(child, { context })', () => {
  it('creates the child with the mapped context, forwards its events with a path, and completes the parent with its output', async () => {
    const { deps, shipments } = fakeDeps()
    const wizard = createWizard(order, { context: { orderId: 'o-1', amount: 30 }, deps })
    const events: WizardEvent<typeof order>[] = []
    wizard.observe((e) => events.push(e))

    // Before the flow step is active there is no child yet (a programmer error, so it throws).
    try {
      wizard.child('fulfil')
      expect.unreachable()
    } catch (error) {
      expect(isWizardError(error) && error.code).toBe('NOT_ACTIVE')
    }

    await wizard.start() // pay (sync) → fulfil enters → child created and started
    expect(wizard.getState().steps.pay).toMatchObject({
      status: 'done',
      output: { chargeId: 'ch_o-1' },
    })
    expect(wizard.getState().steps.fulfil).toMatchObject({
      status: 'active',
      child: { status: 'waiting', current: 'pick' }, // the parent keeps a summary of the child
    })
    expect(wizard.getState().status).toBe('waiting')

    // The typed child wizard: its own instance, context parsed by ITS boundary (default applied).
    const child = wizard.child('fulfil')
    expect(child.flow).toBe(fulfilment)
    expect(child.id).not.toBe(wizard.id)
    expect(child.getState().context).toEqual({ orderId: 'o-1', warehouse: 'east' })
    expect(child.getState().current).toBe('pick')
    expect(wizard.child('fulfil')).toBe(child) // memoised

    // Child events are visible on the parent's observe()/log() with their own path.
    const parentEvents = events.filter((e) => e.path.length === 0)
    const childEvents = events.filter((e) => e.path.length === 1 && e.path[0] === 'fulfil')
    expect(parentEvents.find((e) => e.type === 'child.started')).toMatchObject({
      step: 'fulfil',
      childPath: ['fulfil'],
      context: { orderId: 'o-1' },
    })
    expect(childEvents.map((e) => e.type).slice(0, 2)).toEqual(['flow.started', 'step.arrived'])
    expect(childEvents.every((e) => e.path[0] === 'fulfil')).toBe(true)

    // Drive the child directly.
    expect(await child.setInput('pick', { warehouse: 'west' })).toMatchObject({ ok: true })
    expect(await child.next()).toMatchObject({ ok: true, from: 'pick', to: 'ship' })
    await settle() // the async carrier call resolves
    expect(shipments).toEqual([['o-1', 'west']])
    expect(child.getState().status).toBe('done')
    expect(child.getState().output).toEqual({ tracking: 'TRK-WEST-o-1' })

    // … which completes the parent's flow step with the child's output and finishes the parent.
    expect(wizard.getState().steps.fulfil).toMatchObject({
      status: 'done',
      output: { tracking: 'TRK-WEST-o-1' },
      child: { status: 'done', progress: 1 },
    })
    expect(wizard.getState().context.tracking).toBe('TRK-WEST-o-1')
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toEqual({ orderId: 'o-1', tracking: 'TRK-WEST-o-1' })
    expect(events.filter((e) => e.path.length === 0).map((e) => e.type)).toContain('flow.done')

    // The parent snapshot nests the child's snapshot (persisted and resumed together).
    const snapshot = wizard.getSnapshot()
    expect(Object.keys(snapshot.children)).toEqual(['fulfil'])
    expect(snapshot.children.fulfil).toMatchObject({
      v: 1,
      flow: { name: 'fulfilment', version: 1 },
      instanceId: child.id,
      state: { status: 'done', context: { orderId: 'o-1', warehouse: 'west' } },
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    wizard.dispose()
  })

  it('routes wire commands to the child through the parent (dispatch { type: "child" })', async () => {
    const { deps } = fakeDeps()
    const wizard = createWizard(order, { context: { orderId: 'o-2', amount: 5 }, deps })
    const events: WizardEvent<typeof order>[] = []
    wizard.observe((e) => events.push(e))
    await wizard.start()

    // `dispatch` is typed by the flow (`Command<typeof order>`): a child command whose path is not
    // a flow step does not compile. Untrusted JSON goes through `parseCommand(flow, body)` first,
    // which rejects it with issues; the typed value it returns is what `dispatch` accepts.
    expect(
      parseCommand(order, { type: 'child', path: ['pay'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, issues: [{ message: "'pay' is not a flow step" }] })
    const decoded = parseCommand(order, {
      type: 'child',
      path: ['fulfil'],
      command: { type: 'setInput', step: 'pick', patch: { warehouse: 'east' } },
    })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(await wizard.dispatch(decoded.value)).toMatchObject({ ok: true })

    expect(
      await wizard.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({ ok: true })
    expect(events.filter((e) => e.type === 'child.command')).toHaveLength(2)
    await settle()
    expect(wizard.child('fulfil').getState().status).toBe('done')
    expect(wizard.getState().output).toEqual({ orderId: 'o-2', tracking: 'TRK-EAST-o-2' })
    wizard.dispose()
  })
})
