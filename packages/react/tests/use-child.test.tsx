/**
 * `useChild(step)` (v0.2): hooks bound to a nested flow's slice — over a loopback Mirror (the
 * `steps[step].child` slice of the projection) and over a FlowRun (`getSnapshot().children`);
 * `useSnapshot()` is null before the child exists, `useStep` reads the child step + scoped
 * helpers, `useActions()` sends `child` commands, nested `useChild` reaches a grandchild.
 */
import {
  createMirror,
  createMirrorSource,
  createRun,
  defineFlow,
  defineProjection,
} from '@openwizard/core'
import { createLocalTransport } from '@openwizard/core/testing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { bindReact } from '../src/index'
import { tick } from './fixture'

afterEach(cleanup)

const grandchild = defineFlow({ name: 'grandchild', context: z.object({ sku: z.string() }) })
const grandchildFlow = grandchild.steps({
  pick: grandchild.view({ input: z.object({ bin: z.string() }), next: 'done' }),
  done: grandchild.final(),
})
const fulfilment = defineFlow({
  name: 'fulfilment',
  context: z.object({ orderId: z.string(), warehouse: z.string().optional() }),
})
const fulfilmentFlow = fulfilment.steps({
  confirm: fulfilment.view({
    input: z.object({ warehouse: z.string() }),
    exit: ({ output, update }) => update({ warehouse: output.warehouse }),
    next: 'pack',
  }),
  pack: fulfilment.flow(grandchildFlow, { context: () => ({ sku: 'sku-1' }), next: 'done' }),
  done: fulfilment.final({ output: ({ context }) => ({ warehouse: context.warehouse }) }),
})
const order = defineFlow({ name: 'order', context: z.object({ cartId: z.string() }) })
const orderFlow = order.steps(
  {
    intro: order.view({ next: 'fulfil' }),
    fulfil: order.flow(fulfilmentFlow, {
      context: ({ context }) => ({ orderId: context.cartId }),
      next: 'end',
    }),
    end: order.final(),
  },
  { start: 'intro' },
)
const orderClient = defineProjection(orderFlow, {
  expose: {
    steps: {
      fulfil: {
        child: {
          steps: {
            confirm: { input: true },
            pack: { child: { steps: { pick: { input: true } } } },
          },
          context: ['orderId'],
        },
      },
    },
  },
})

const owMirror = bindReact<typeof orderClient>()
const owFlow = bindReact<typeof orderFlow>()

/** Structural presentational component: works over both bindings' child hooks. */
interface ConfirmLike {
  readonly status: string
  readonly input?: { readonly warehouse?: string }
  setInput(patch: { warehouse?: string }): Promise<unknown>
  next(): Promise<unknown>
}
function ConfirmView({ step }: { step: ConfirmLike }) {
  return (
    <div>
      <span data-testid="confirm-status">{step.status}</span>
      <span data-testid="confirm-warehouse">{step.input?.warehouse ?? ''}</span>
      <button type="button" onClick={() => void step.setInput({ warehouse: 'east' })}>
        fill
      </button>
      <button type="button" onClick={() => void step.next()}>
        next
      </button>
    </div>
  )
}

async function loop() {
  const run = createRun(orderFlow, { context: { cartId: 'c-1' } })
  await run.start()
  const source = createMirrorSource(run, orderClient)
  const mirror = createMirror<typeof orderClient>({ transport: createLocalTransport(source) })
  return { run, mirror }
}

describe('useChild over a Mirror', () => {
  it('reads the child slice (null before the child exists), binds child step helpers, nests', async () => {
    const { run, mirror } = await loop()
    const child = owMirror.useChild
    let renders = 0
    function Fulfilment() {
      renders += 1
      const snap = owMirror.useChild('fulfil').useSnapshot()
      if (snap === null) return <span data-testid="child">no child yet</span>
      return (
        <div>
          <span data-testid="child">
            {snap.current ?? 'none'}/{snap.context.orderId}
          </span>
          <Confirm />
          {snap.steps.pack.status === 'active' ? <Pick /> : null}
        </div>
      )
    }
    function Confirm() {
      return <ConfirmView step={child('fulfil').useStep('confirm')} />
    }
    function Pick() {
      const pick = owMirror.useChild('fulfil').useChild('pack').useStep('pick')
      const actions = owMirror.useChild('fulfil').useChild('pack').useActions()
      return (
        <div>
          <span data-testid="pick">
            {pick.status}:{pick.input?.bin ?? ''}
          </span>
          <button type="button" onClick={() => void pick.setInput({ bin: 'B-7' })}>
            bin
          </button>
          <button type="button" onClick={() => void actions.next()}>
            pack-next
          </button>
        </div>
      )
    }
    render(
      <owMirror.Provider source={mirror}>
        <Fulfilment />
      </owMirror.Provider>,
    )
    // The cursor is on `intro`: the flow step has not been entered → no child slice.
    expect(screen.getByTestId('child').textContent).toBe('no child yet')

    await act(async () => {
      await mirror.next() // intro → fulfil (child created, `confirm` current)
      await tick()
    })
    expect(screen.getByTestId('child').textContent).toBe('confirm/c-1')
    expect(screen.getByTestId('confirm-status').textContent).toBe('active')
    // Child step helpers send child commands through the mirror.
    await act(async () => {
      screen.getByText('fill').click()
      await tick()
    })
    expect(screen.getByTestId('confirm-warehouse').textContent).toBe('east')
    expect(run.child('fulfil').getState().steps.confirm.input).toEqual({ warehouse: 'east' })
    await act(async () => {
      screen.getByText('next').click()
      await tick()
    })
    // confirm → pack: the grandchild exists; nested useChild reads it.
    expect(screen.getByTestId('child').textContent).toBe('none/c-1')
    expect(screen.getByTestId('pick').textContent).toBe('active:')
    await act(async () => {
      screen.getByText('bin').click()
      await tick()
    })
    expect(screen.getByTestId('pick').textContent).toBe('active:B-7')
    await act(async () => {
      screen.getByText('pack-next').click()
      await tick()
    })
    expect(run.getState().status).toBe('done')
    expect(run.getState().steps.fulfil.output).toEqual({ warehouse: 'east' })
    // Child bindings are memoised: the same hooks object every render.
    expect(owMirror.useChild).toBe(child)
    expect(renders).toBeGreaterThan(0)
    run.dispose()
    mirror.dispose()
  })

  it('useStep throws while the child has no state (render it under a useSnapshot() guard); the binding identity is stable', async () => {
    const { run, mirror } = await loop()
    const bindings: unknown[] = []
    function Bad() {
      const binding = owMirror.useChild('fulfil')
      bindings.push(binding)
      const confirm = binding.useStep('confirm')
      return <span>{confirm.status}</span>
    }
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    expect(() =>
      render(
        <owMirror.Provider source={mirror}>
          <Bad />
        </owMirror.Provider>,
      ),
    ).toThrow(/useChild\('fulfil'\)\.useStep\('confirm'\): the child flow has no state yet/)
    window.removeEventListener('error', onError)
    expect(bindings.length).toBeGreaterThan(0)
    expect(new Set(bindings).size).toBe(1)
    run.dispose()
    mirror.dispose()
  })
})

describe('useChild over a FlowRun', () => {
  it('reads the child snapshot state and drives the child through child commands', async () => {
    const run = createRun(orderFlow, { context: { cartId: 'c-2' } })
    await run.start()
    function Confirm() {
      return <ConfirmView step={owFlow.useChild('fulfil').useStep('confirm')} />
    }
    function Fulfilment() {
      const snap = owFlow.useChild('fulfil').useSnapshot()
      if (snap === null) return <span data-testid="child">no child yet</span>
      return (
        <div>
          <span data-testid="child">
            {snap.current ?? 'none'}/{snap.context.orderId}
          </span>
          <Confirm />
        </div>
      )
    }
    render(
      <owFlow.Provider source={run}>
        <Fulfilment />
      </owFlow.Provider>,
    )
    expect(screen.getByTestId('child').textContent).toBe('no child yet')
    await act(async () => {
      await run.next()
    })
    expect(screen.getByTestId('child').textContent).toBe('confirm/c-2')
    await act(async () => {
      screen.getByText('fill').click()
      await tick()
    })
    expect(screen.getByTestId('confirm-warehouse').textContent).toBe('east')
    await act(async () => {
      screen.getByText('next').click()
      await tick()
    })
    expect(run.child('fulfil').getState().steps.confirm.status).toBe('done')
    // Nested over a FlowRun: the grandchild snapshot.
    let grand: unknown
    function Grand() {
      grand = owFlow.useChild('fulfil').useChild('pack').useSnapshot()
      return null
    }
    render(
      <owFlow.Provider source={run}>
        <Grand />
      </owFlow.Provider>,
    )
    expect(grand).toMatchObject({ current: 'pick', context: { sku: 'sku-1' } })
    run.dispose()
  })
})
