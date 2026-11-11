import { defineProjection, isWizardError, parseCommand, type RunEvent } from '@openwizard/core'
import { createMirror, createMirrorSource } from '@openwizard/core/mirror'
import { createLocalTransport } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, fulfilmentFlow, orderFlow } from './order'

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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('06 nested flow: order.flow(child, { context })', () => {
  it('creates the child with the mapped context, forwards its events with a path, and completes the parent with its output', async () => {
    const { deps, shipments } = fakeDeps()
    const run = orderFlow.create({ orderId: 'o-1', amount: 30 }, { deps })
    const events: RunEvent<typeof orderFlow>[] = []
    run.observe((event) => events.push(event))

    // Before the flow step is active there is no child yet (a programmer error, so it throws).
    try {
      run.child('fulfil')
      expect.unreachable()
    } catch (error) {
      expect(isWizardError(error) && error.code).toBe('NOT_ACTIVE')
    }

    await run.start() // pay (sync) → fulfil enters → child created and started
    expect(run.getState().steps.pay).toMatchObject({
      status: 'done',
      output: { chargeId: 'ch_o-1' },
    })
    expect(run.getState().steps.fulfil).toMatchObject({
      status: 'active',
      child: { status: 'waiting', current: 'pick' }, // the parent keeps a summary of the child
    })
    expect(run.getState().status).toBe('waiting')

    // The typed child run: its own instance, context parsed by ITS boundary (default applied).
    const child = run.child('fulfil')
    expect(child.flow).toBe(fulfilmentFlow)
    expect(child.id).not.toBe(run.id)
    expect(child.getState().context).toEqual({ orderId: 'o-1', warehouse: 'east' })
    expect(child.getState().current).toBe('pick')
    expect(run.child('fulfil')).toBe(child) // memoised

    // Child events are visible on the parent's observe()/log() with their own path.
    const parentEvents = events.filter((event) => event.path.length === 0)
    const childEvents = events.filter(
      (event) => event.path.length === 1 && event.path[0] === 'fulfil',
    )
    expect(parentEvents.find((event) => event.type === 'child.started')).toMatchObject({
      step: 'fulfil',
      childPath: ['fulfil'],
      context: { orderId: 'o-1' },
    })
    expect(childEvents.map((event) => event.type).slice(0, 2)).toEqual([
      'flow.started',
      'step.arrived',
    ])
    expect(childEvents.every((event) => event.path[0] === 'fulfil')).toBe(true)

    // Drive the child directly.
    expect(await child.setInput('pick', { warehouse: 'west' })).toMatchObject({ ok: true })
    expect(await child.next()).toMatchObject({ ok: true, from: 'pick', to: 'ship' })
    await settle() // the async carrier call resolves
    expect(shipments).toEqual([['o-1', 'west']])
    expect(child.getState().status).toBe('done')
    expect(child.getState().output).toEqual({ tracking: 'TRK-WEST-o-1' })

    // … which completes the parent's flow step with the child's output and finishes the parent.
    expect(run.getState().steps.fulfil).toMatchObject({
      status: 'done',
      output: { tracking: 'TRK-WEST-o-1' },
      child: { status: 'done', progress: 1 },
    })
    expect(run.getState().context.tracking).toBe('TRK-WEST-o-1')
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toEqual({ orderId: 'o-1', tracking: 'TRK-WEST-o-1' })
    expect(events.filter((event) => event.path.length === 0).map((event) => event.type)).toContain(
      'flow.done',
    )

    // The parent snapshot nests the child's snapshot (persisted and resumed together).
    const snapshot = run.getSnapshot()
    expect(Object.keys(snapshot.children)).toEqual(['fulfil'])
    expect(snapshot.children.fulfil).toMatchObject({
      v: 1,
      flow: { name: 'fulfilment', version: 1 },
      instanceId: child.id,
      state: { status: 'done', context: { orderId: 'o-1', warehouse: 'west' } },
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    run.dispose()
  })

  it('routes child wire commands through the parent run', async () => {
    const { deps } = fakeDeps()
    const run = orderFlow.create({ orderId: 'o-2', amount: 5 }, { deps })
    const events: RunEvent<typeof orderFlow>[] = []
    run.observe((event) => events.push(event))
    await run.start()

    // `dispatch` is typed by the flow (`Command<typeof order>`): a child command whose path is not
    // a flow step does not compile. Untrusted JSON goes through `parseCommand(flow, body)` first,
    // which rejects it with issues; the typed value it returns is what `dispatch` accepts.
    expect(
      parseCommand(orderFlow, { type: 'child', path: ['pay'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, issues: [{ message: "'pay' is not a flow step" }] })
    const decoded = parseCommand(orderFlow, {
      type: 'child',
      path: ['fulfil'],
      command: { type: 'setInput', step: 'pick', patch: { warehouse: 'east' } },
    })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(await run.dispatch(decoded.value)).toMatchObject({ ok: true })

    expect(
      await run.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({ ok: true })
    expect(events.filter((event) => event.type === 'child.command')).toHaveLength(2)
    await settle()
    expect(run.child('fulfil').getState().status).toBe('done')
    expect(run.getState().output).toEqual({ orderId: 'o-2', tracking: 'TRK-EAST-o-2' })
    run.dispose()
  })
  it('lets a Mirror drive a child exposed by the projection', async () => {
    const { deps, shipments } = fakeDeps()
    const run = orderFlow.create({ orderId: 'o-3', amount: 12 }, { deps })
    await run.start()
    // The projection exposes the child's projected state under `steps.fulfil.child` (deny-by-default
    // inside too: only the pick draft and the child's current view cross the wire).
    const orderClient = defineProjection(orderFlow, {
      expose: {
        steps: { fulfil: { output: true, child: { steps: { pick: { input: true } } } } },
        output: true,
      },
    })
    const source = createMirrorSource(run, orderClient)
    const mirror = createMirror<typeof orderClient>({
      transport: createLocalTransport(source, { serialize: true }), // JSON round trip, like a wire
    })
    expect(mirror.getSnapshot()?.steps.fulfil.child).toMatchObject({
      current: 'pick',
      steps: { pick: { status: 'active' } },
    })

    // `mirror.child('fulfil')` is the child's command sugar, typed by the CHILD flow; every call
    // travels as { type: 'child', path: ['fulfil'], command } and is decoded against the child.
    const fulfil = mirror.child('fulfil')
    expect(fulfil.path).toEqual(['fulfil'])
    expect(await fulfil.setInput('pick', { warehouse: 'east' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.fulfil.child?.steps.pick.input).toEqual({
      warehouse: 'east',
    })
    expect(await fulfil.next()).toMatchObject({ ok: true })
    await settle()
    expect(shipments).toEqual([['o-3', 'east']])
    expect(mirror.getSnapshot()).toMatchObject({
      status: 'done',
      output: { orderId: 'o-3', tracking: 'TRK-EAST-o-3' },
      steps: { fulfil: { status: 'done', output: { tracking: 'TRK-EAST-o-3' } } },
    })
    mirror.dispose()
    run.dispose()
  })
})
