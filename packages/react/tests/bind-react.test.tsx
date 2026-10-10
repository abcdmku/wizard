/**
 * `bindReact<typeof flow>()` over a real Wizard: typed hooks, render counters (a step re-renders
 * only when its slice changes), `useSelector` equality, stable action identities, errors outside
 * the Provider, StrictMode.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReact } from '../src/index'
import { type checkout, type checkoutClient, controlledDeps, makeWizard, tick } from './fixture'

afterEach(cleanup)

const owFlow = bindReact<typeof checkout>()
const owMirror = bindReact<typeof checkoutClient>()

// The two bindings have different hook types (a union of generic methods is not callable), so
// each test tree uses a thin per-binding wrapper around structural presentational components.
interface ShippingLike {
  readonly status: string
  readonly input?: { readonly address?: string }
  readonly issues?: readonly { readonly message: string }[]
  setInput(patch: { address?: string }): Promise<unknown>
  next(): Promise<unknown>
}
interface ReserveLike {
  readonly status: string
  readonly attempt: number
}

function ShippingView({ step }: { step: ShippingLike }) {
  return (
    <div>
      <span data-testid="shipping-status">{step.status}</span>
      <span data-testid="shipping-address">{step.input?.address ?? ''}</span>
      <span data-testid="shipping-issues">
        {step.issues?.map((i) => i.message).join('|') ?? ''}
      </span>
      <button type="button" onClick={() => void step.setInput({ address: 'Main St' })}>
        fill
      </button>
      <button type="button" onClick={() => void step.next()}>
        next
      </button>
    </div>
  )
}
function ReserveView({ step }: { step: ReserveLike }) {
  return (
    <span data-testid="reserve-status">
      {step.status}:{step.attempt}
    </span>
  )
}
function StatusView({ status, current }: { status: string; current: string | null }) {
  return (
    <span data-testid="status">
      {status}/{current ?? 'none'}
    </span>
  )
}

const Shipping = {
  flow: ({ counter }: { counter: () => void }) => {
    counter()
    return <ShippingView step={owFlow.useStep('shipping')} />
  },
  mirror: ({ counter }: { counter: () => void }) => {
    counter()
    return <ShippingView step={owMirror.useStep('shipping')} />
  },
}
const Reserve = {
  flow: ({ counter }: { counter: () => void }) => {
    counter()
    return <ReserveView step={owFlow.useStep('reserve')} />
  },
  mirror: ({ counter }: { counter: () => void }) => {
    counter()
    return <ReserveView step={owMirror.useStep('reserve')} />
  },
}
const Status = {
  flow: () => (
    <StatusView
      status={owFlow.useSelector((s) => s.status)}
      current={owFlow.useCurrent()?.id ?? null}
    />
  ),
  mirror: () => (
    <StatusView
      status={owMirror.useSelector((s) => s.status)}
      current={owMirror.useCurrent()?.id ?? null}
    />
  ),
}

describe('bindReact over a Wizard', () => {
  it('renders view → task → final through the hooks and re-renders only the touched slices', async () => {
    const { deps, release } = controlledDeps()
    const wizard = makeWizard(deps)
    await wizard.start()
    let shippingRenders = 0
    let reserveRenders = 0
    render(
      <owFlow.Provider source={wizard}>
        <Shipping.flow
          counter={() => {
            shippingRenders += 1
          }}
        />
        <Reserve.flow
          counter={() => {
            reserveRenders += 1
          }}
        />
        <Status.flow />
      </owFlow.Provider>,
    )
    expect(screen.getByTestId('shipping-status').textContent).toBe('active')
    expect(screen.getByTestId('reserve-status').textContent).toBe('idle:0')
    expect(screen.getByTestId('status').textContent).toBe('waiting/shipping')
    const s0 = shippingRenders
    const r0 = reserveRenders

    // Invalid draft → issues on the shipping slice only.
    await act(async () => {
      await wizard.next()
    })
    expect(screen.getByTestId('shipping-issues').textContent).not.toBe('')
    expect(shippingRenders).toBeGreaterThan(s0)
    expect(reserveRenders).toBe(r0)

    const s1 = shippingRenders
    await act(async () => {
      screen.getByText('fill').click()
      await tick()
    })
    expect(screen.getByTestId('shipping-address').textContent).toBe('Main St')
    expect(shippingRenders).toBeGreaterThan(s1)
    expect(reserveRenders).toBe(r0) // untouched slice: no re-render

    await act(async () => {
      screen.getByText('next').click()
      await tick()
    })
    expect(screen.getByTestId('reserve-status').textContent).toBe('active:1')
    expect(screen.getByTestId('status').textContent).toBe('running/none')
    expect(reserveRenders).toBeGreaterThan(r0)

    await act(async () => {
      release()
      await tick()
    })
    expect(screen.getByTestId('reserve-status').textContent).toBe('done:1')
    expect(screen.getByTestId('status').textContent).toBe('done/none')
    expect(wizard.getState().output).toEqual({ cartId: 'c1' })
    wizard.dispose()
  })

  it('useSnapshot returns the wizard state; useActions is stable and typed by the flow', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const seen: unknown[] = []
    function Probe() {
      const state = owFlow.useSnapshot()
      const actions = owFlow.useActions()
      seen.push(actions)
      return (
        <div>
          <span data-testid="ctx">{String(state.context.total)}</span>
          <button
            type="button"
            onClick={() => void actions.setInput('shipping', { express: true })}
          >
            express
          </button>
        </div>
      )
    }
    render(
      <owFlow.Provider source={wizard}>
        <Probe />
      </owFlow.Provider>,
    )
    expect(screen.getByTestId('ctx').textContent).toBe('10')
    await act(async () => {
      screen.getByText('express').click()
      await tick()
    })
    expect(wizard.getState().steps.shipping.input).toEqual({ express: true })
    expect(seen.length).toBeGreaterThan(1)
    expect(new Set(seen).size).toBe(1) // one actions object per source
    // NavResult (not the ack shape) comes back from a Wizard source.
    let nav: unknown
    await act(async () => {
      nav = await (seen[0] as ReturnType<typeof owFlow.useActions>).next()
    })
    expect(nav).toMatchObject({ ok: false, code: 'INVALID_INPUT', reason: expect.any(String) })
    wizard.dispose()
  })

  it('useSelector re-renders only when isEqual says the selection changed', async () => {
    const wizard = makeWizard()
    await wizard.start()
    let objRenders = 0
    let shallowRenders = 0
    const shallow = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])
    function Fresh() {
      objRenders += 1
      // A fresh object every time: with Object.is it re-renders on every commit.
      const sel = owFlow.useSelector((s) => ({ current: s.current }))
      return <span data-testid="fresh">{sel.current}</span>
    }
    function Shallow() {
      shallowRenders += 1
      const sel = owFlow.useSelector((s) => ({ current: s.current }), shallow)
      return <span data-testid="shallow">{sel.current}</span>
    }
    render(
      <owFlow.Provider source={wizard}>
        <Fresh />
        <Shallow />
      </owFlow.Provider>,
    )
    const o0 = objRenders
    const s0 = shallowRenders
    await act(async () => {
      await wizard.setInput('shipping', { address: 'x' }) // commit that leaves `current` alone
    })
    expect(objRenders).toBeGreaterThan(o0)
    expect(shallowRenders).toBe(s0)
    await act(async () => {
      await wizard.next()
      await tick()
    })
    expect(screen.getByTestId('shallow').textContent).toBe('')
    expect(shallowRenders).toBeGreaterThan(s0)
    wizard.dispose()
  })

  it('hooks outside the Provider throw a descriptive error', () => {
    function Lost() {
      owFlow.useSnapshot()
      return null
    }
    expect(() => render(<Lost />)).toThrow(/useSnapshot\(\) must be used inside the <Provider>/)
  })

  it('useActions carries the whole Wizard sugar (start/run/reset/compensate, send with correlationId)', async () => {
    const wizard = makeWizard()
    let actions: ReturnType<typeof owFlow.useActions> | undefined
    function Probe() {
      actions = owFlow.useActions()
      return null
    }
    render(
      <owFlow.Provider source={wizard}>
        <Probe />
      </owFlow.Provider>,
    )
    if (actions === undefined) throw new Error('not rendered')
    for (const name of ['start', 'run', 'reset', 'compensate', 'runReady', 'cancel'] as const) {
      expect(typeof actions[name]).toBe('function')
    }
    await act(async () => {
      expect(await actions?.start()).toMatchObject({ ok: true })
    })
    expect(wizard.getState().current).toBe('shipping')
    await act(async () => {
      await actions?.send('payment.captured', { paymentId: 'p' }, { correlationId: 'corr-9' })
    })
    expect(wizard.log().find((e) => e.type === 'event.received')).toMatchObject({
      correlationId: 'corr-9',
    })
    await act(async () => {
      expect(await actions?.reset()).toMatchObject({ ok: true })
    })
    expect(wizard.getState().status).toBe('idle')
    wizard.dispose()
  })

  it('works under StrictMode (double render, effect replay)', async () => {
    const wizard = makeWizard()
    await wizard.start()
    render(
      <StrictMode>
        <owFlow.Provider source={wizard}>
          <Status.flow />
        </owFlow.Provider>
      </StrictMode>,
    )
    expect(screen.getByTestId('status').textContent).toBe('waiting/shipping')
    await act(async () => {
      await wizard.setInput('shipping', { address: 'x' })
      await wizard.next()
      await tick()
    })
    expect(screen.getByTestId('status').textContent).toBe('done/none')
    wizard.dispose()
  })
})
