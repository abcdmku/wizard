/**
 * (e) nested flows with the REAL machine: a parent `flow` step creates a child
 * (view → task → final inside), `child()` accessor, child events forwarded with
 * `path`, child done → parent step done with the child output, the child
 * context boundary, `getSnapshot().children`, `dispatch({type:'child'})` through
 * the parent FIFO, and a failing child.
 */

import { describe, expect, it } from 'vitest'
import { flow, flowStep, guard, routingStep, runStep, view } from '../../helpers/fixtures'
import { e2e } from './harness'

const child = () =>
  flow({
    name: 'fulfil',
    start: 'confirm',
    steps: {
      confirm: view({ next: 'ship' }),
      ship: runStep({
        run: ({ context }) => ({ tracking: `TRK-${(context as any).orderId}` }),
        next: 'done',
      }),
      done: runStep({
        needs: { ship: { kind: 'all', steps: ['ship'] } },
        run: ({ needs }) => needs.ship,
      }),
    },
  })

const parent = (childDef = child()) =>
  flow({
    name: 'checkout',
    start: 'pay',
    steps: {
      pay: runStep({ run: () => ({ orderId: 'o-1' }), next: 'fulfil' }),
      fulfil: flowStep(childDef, {
        needs: { pay: { kind: 'all', steps: ['pay'] } },
        context: ({ needs }) => ({ orderId: (needs.pay as { orderId: string }).orderId }),
        next: 'receipt',
      }),
      receipt: runStep({
        needs: { fulfil: { kind: 'all', steps: ['fulfil'] } },
        run: ({ needs }) => ({ tracking: (needs.fulfil as { tracking: string }).tracking }),
      }),
    },
  })

describe('e2e nested flows', () => {
  it('creates the child with the mapped context, forwards its events with path, and completes the parent with its output', async () => {
    const t = e2e(parent())
    expect(() => t.run.child('fulfil')).toThrow(/not been created/)
    await t.run.start()
    // The parent task ran, the flow step entered, childContext ran, the child was created and started.
    expect(t.rec('fulfil').status).toBe('active')
    const c = t.run.child('fulfil')
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
    expect(t.run.getState().status).toBe('waiting')
    // Drive the child directly.
    expect(await c.next()).toMatchObject({ ok: true, from: 'confirm', to: 'ship' })
    expect(c.getState().status).toBe('done')
    expect(c.getState().output).toEqual({ tracking: 'TRK-o-1' })
    // ... which completes the parent flow step with the child output and finishes the parent.
    expect(t.rec('fulfil')).toMatchObject({ status: 'done', output: { tracking: 'TRK-o-1' } })
    expect(t.rec('fulfil').child).toMatchObject({ status: 'done', progress: 1 })
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toEqual({ tracking: 'TRK-o-1' })
    // Snapshot includes the child.
    const snap = t.run.getSnapshot()
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
      await t.run.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      code: 'FLOW_NOT_STARTED',
    })
    await t.run.start()
    expect(
      await t.run.dispatch({ type: 'child', path: ['pay'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      code: 'NOT_A_FLOW_STEP',
      step: 'pay',
    })
    t.clear()
    const r = await t.run.dispatch({
      type: 'child',
      path: ['fulfil'],
      command: { type: 'next' },
    })
    expect(r).toMatchObject({ ok: true })
    expect(t.of('child.command')[0]).toMatchObject({ step: 'fulfil', command: { type: 'next' } })
    // The child processed `next` (view → task → final) and the parent finished.
    expect(t.run.child('fulfil').getState().status).toBe('done')
    expect(t.run.getState().status).toBe('done')
    // Terminal parent still lets `child` commands through the gate; the child answers itself.
    expect(
      await t.run.dispatch({ type: 'child', path: ['fulfil'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, code: 'NOT_ACTIVE' })
  })

  it('a child context rejected by the child flow boundary fails the flow step (kind hook, boundary issues)', async () => {
    const strictChild = {
      ...child(),
      context: guard((v) => typeof (v as any)?.orderId === 'number', 'orderId must be a number'),
    }
    const t = e2e(parent(strictChild))
    await t.run.start()
    expect(t.rec('fulfil')).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', name: 'BoundaryRejection' },
    })
    expect(t.rec('fulfil').error?.message).toContain('orderId must be a number')
    expect(() => t.run.child('fulfil')).toThrow()
    expect(t.run.getState().status).toBe('halted')
  })

  it('a halted child halts the parent (its flow step stays active); recovering the child finishes the parent', async () => {
    let fail = true
    const boom = flow({
      name: 'boom',
      start: 't',
      steps: {
        t: runStep({
          run: () => {
            if (fail) throw new Error('child task exploded')
            return 'fixed'
          },
        }),
      },
    })
    const p = flow({
      name: 'p',
      start: 'f',
      steps: { f: flowStep(boom, { context: () => ({}), next: 'end' }), end: routingStep() },
    })
    const t = e2e(p)
    await t.run.start()
    expect(t.run.child('f').getState().status).toBe('halted')
    expect(t.rec('f').status).toBe('active')
    expect(t.run.getState().status).toBe('halted')
    expect(t.run.outcome()).toMatchObject({
      status: 'halted',
      failure: {
        kind: 'step',
        step: 'f',
        error: { kind: 'child', message: 'child task exploded' },
        child: {
          status: 'halted',
          failure: { step: 't', error: { message: 'child task exploded' } },
        },
      },
    })

    fail = false
    expect(await t.run.child('f').retry('t')).toMatchObject({ ok: true })
    expect(t.run.getState().status).toBe('done')
  })

  it('a flow step with a childOutput hook maps the child output; two levels of nesting keep their paths', async () => {
    const leaf = flow({
      name: 'leaf',
      start: 't',
      steps: {
        t: runStep({ run: () => 'leaf-out', next: 'e' }),
        e: runStep({
          needs: { t: { kind: 'all', steps: ['t'] } },
          run: ({ needs }) => needs.t,
        }),
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
        e: runStep({
          needs: { f: { kind: 'all', steps: ['f'] } },
          run: ({ needs }) => needs.f,
        }),
      },
    })
    const root = flow({
      name: 'root',
      start: 'f',
      steps: {
        f: flowStep(mid, { context: () => ({}), next: 'e' }),
        e: runStep({
          needs: { f: { kind: 'all', steps: ['f'] } },
          run: ({ needs }) => needs.f,
        }),
      },
    })
    const t = e2e(root)
    await t.run.start()
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toEqual({ wrapped: 'leaf-out' })
    expect(t.run.child('f').child('f').path).toEqual(['f', 'f'])
    const paths = new Set(t.events.map((e) => e.path.join('/')))
    expect(paths).toEqual(new Set(['', 'f', 'f/f']))
    expect(Object.keys(t.run.getSnapshot().children.f?.children ?? {})).toEqual(['f'])
  })
})
