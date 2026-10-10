/**
 * (e) nested flows with the REAL machine: a parent `flow` step creates a child
 * (view → task → final inside), `child()` accessor, child events forwarded with
 * `path`, child done → parent step done with the child output, the child
 * context boundary, `getSnapshot().children`, `dispatch({type:'child'})` through
 * the parent FIFO, and a failing child.
 */

import { describe, expect, it } from 'vitest'
import { final, flow, flowStep, guard, task, view } from '../../helpers/fixtures'
import { e2e } from './harness'

const child = () =>
  flow({
    name: 'fulfil',
    start: 'confirm',
    steps: {
      confirm: view({ next: 'ship' }),
      ship: task({
        run: ({ context }) => ({ tracking: `TRK-${(context as any).orderId}` }),
        next: 'done',
      }),
      done: final({ output: ({ steps }) => steps.ship!.output }),
    },
  })

const parent = (childDef = child()) =>
  flow({
    name: 'checkout',
    start: 'pay',
    steps: {
      pay: task({ run: () => ({ orderId: 'o-1' }), next: 'fulfil' }),
      fulfil: flowStep(childDef, {
        context: ({ steps }) => ({ orderId: (steps.pay!.output as any).orderId }),
        next: 'receipt',
      }),
      receipt: final({
        output: ({ steps }) => ({ tracking: (steps.fulfil!.output as any).tracking }),
      }),
    },
  })

describe('e2e nested flows', () => {
  it('creates the child with the mapped context, forwards its events with path, and completes the parent with its output', async () => {
    const t = e2e(parent())
    expect(() => t.wizard.child('fulfil')).toThrow(/not been created/)
    await t.wizard.start()
    // The parent task ran, the flow step entered, childContext ran, the child was created and started.
    expect(t.rec('fulfil').status).toBe('active')
    const c = t.wizard.child('fulfil')
    expect(c.path).toEqual(['fulfil'])
    expect(c.getState().context).toEqual({ orderId: 'o-1' })
    expect(c.getState().current).toBe('confirm')
    expect(t.of('child.started')[0]).toMatchObject({
      step: 'fulfil',
      childPath: ['fulfil'],
      context: { orderId: 'o-1' },
    })
    // Child events are observable on the parent with their own path.
    const childEvents = t.events.filter((e) => e.path.length === 1 && e.path[0] === 'fulfil')
    expect(childEvents.map((e) => e.type).slice(0, 2)).toEqual(['flow.started', 'step.arrived'])
    expect(childEvents.every((e) => e.path[0] === 'fulfil')).toBe(true)
    // Parent state carries the child summary (waiting on the view).
    expect(t.rec('fulfil').child).toMatchObject({ status: 'waiting', current: 'confirm' })
    expect(t.wizard.getState().status).toBe('waiting')
    // Drive the child directly.
    expect(await c.next()).toMatchObject({ ok: true, from: 'confirm', to: 'ship' })
    expect(c.getState().status).toBe('done')
    expect(c.getState().output).toEqual({ tracking: 'TRK-o-1' })
    // ... which completes the parent flow step with the child output and finishes the parent.
    expect(t.rec('fulfil')).toMatchObject({ status: 'done', output: { tracking: 'TRK-o-1' } })
    expect(t.rec('fulfil').child).toMatchObject({ status: 'done', progress: 1 })
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().output).toEqual({ tracking: 'TRK-o-1' })
    // Snapshot includes the child.
    const snap = t.wizard.getSnapshot()
    expect(Object.keys(snap.children)).toEqual(['fulfil'])
    expect(snap.children.fulfil).toMatchObject({
      v: 1,
      flow: { name: 'fulfil', version: 1 },
      instanceId: c.id,
    })
    expect(snap.children.fulfil?.state.status).toBe('done')
  })

  it('routes wire child commands through the parent FIFO (child.command → child.send) and rejects bad targets', async () => {
    const t = e2e(parent())
    expect(
      await t.wizard.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      code: 'FLOW_NOT_STARTED',
    })
    await t.wizard.start()
    expect(
      await t.wizard.dispatch({ type: 'child', path: ['pay'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      code: 'NOT_A_FLOW_STEP',
      step: 'pay',
    })
    t.clear()
    const r = await t.wizard.dispatch({
      type: 'child',
      path: ['fulfil'],
      command: { type: 'next' },
    })
    expect(r).toMatchObject({ ok: true })
    expect(t.of('child.command')[0]).toMatchObject({ step: 'fulfil', command: { type: 'next' } })
    // The child processed `next` (view → task → final) and the parent finished.
    expect(t.wizard.child('fulfil').getState().status).toBe('done')
    expect(t.wizard.getState().status).toBe('done')
    // Terminal parent still lets `child` commands through the gate; the child answers itself.
    expect(
      await t.wizard.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, code: 'NOT_ACTIVE' })
  })

  it('a child context rejected by the child flow boundary fails the flow step (kind hook, boundary issues)', async () => {
    const strictChild = {
      ...child(),
      context: guard((v) => typeof (v as any)?.orderId === 'number', 'orderId must be a number'),
    }
    const t = e2e(parent(strictChild))
    await t.wizard.start()
    expect(t.rec('fulfil')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', name: 'BoundaryRejection' },
    })
    expect(t.rec('fulfil').error?.message).toContain('orderId must be a number')
    expect(() => t.wizard.child('fulfil')).toThrow()
    expect(t.wizard.getState().status).toBe('failed')
  })

  it('a failing child fails the parent flow step with kind child', async () => {
    const boom = flow({
      name: 'boom',
      start: 't',
      steps: {
        t: task({
          run: () => {
            throw new Error('child task exploded')
          },
        }),
      },
    })
    const p = flow({
      name: 'p',
      start: 'f',
      steps: { f: flowStep(boom, { context: () => ({}), next: 'end' }), end: final() },
    })
    const t = e2e(p)
    await t.wizard.start()
    expect(t.wizard.child('f').getState().status).toBe('failed')
    expect(t.rec('f')).toMatchObject({
      status: 'failed',
      error: { kind: 'child', message: 'child task exploded' },
    })
    expect(t.wizard.getState().status).toBe('failed')
  })

  it('a flow step with a childOutput hook maps the child output; two levels of nesting keep their paths', async () => {
    const leaf = flow({
      name: 'leaf',
      start: 't',
      steps: {
        t: task({ run: () => 'leaf-out', next: 'e' }),
        e: final({ output: ({ steps }) => steps.t!.output }),
      },
    })
    const mid = flow({
      name: 'mid',
      start: 'f',
      steps: {
        f: flowStep(leaf, {
          context: () => ({}),
          output: ({ output }) => ({ wrapped: output }),
          next: 'e',
        }),
        e: final({ output: ({ steps }) => steps.f!.output }),
      },
    })
    const root = flow({
      name: 'root',
      start: 'f',
      steps: {
        f: flowStep(mid, { context: () => ({}), next: 'e' }),
        e: final({ output: ({ steps }) => steps.f!.output }),
      },
    })
    const t = e2e(root)
    await t.wizard.start()
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().output).toEqual({ wrapped: 'leaf-out' })
    expect(t.wizard.child('f').child('f').path).toEqual(['f', 'f'])
    const paths = new Set(t.events.map((e) => e.path.join('/')))
    expect(paths).toEqual(new Set(['', 'f', 'f/f']))
    expect(Object.keys(t.wizard.getSnapshot().children.f?.children ?? {})).toEqual(['f'])
  })
})
