/**
 * `bindReact<typeof projection>()` over a Mirror — loopback rendering, fallback until the first
 * frame, ack results, StrictMode listener leaks. (SSR and transport behaviour: mirror-client.test.tsx.)
 */
import { createMirror, createMirrorSource, type Mirror } from '@openwizard/core/mirror'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReact } from '../src/index'
import {
  checkoutClient,
  type checkoutFlow,
  controlledDeps,
  makeMirror,
  makeRun,
  tick,
} from './fixture'

afterEach(cleanup)

const owFlow = bindReact<typeof checkoutFlow>()
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

describe('bindReact over a Mirror', () => {
  it('drives the flow through the loopback; the projected state is what the hooks see', async () => {
    const { deps, release } = controlledDeps()
    const { run, mirror } = await makeMirror(deps)
    let shippingRenders = 0
    let reserveRenders = 0
    render(
      <owMirror.Provider source={mirror} fallback={<p>connecting</p>}>
        <Shipping.mirror
          counter={() => {
            shippingRenders += 1
          }}
        />
        <Reserve.mirror
          counter={() => {
            reserveRenders += 1
          }}
        />
        <Status.mirror />
      </owMirror.Provider>,
    )
    expect(screen.queryByText('connecting')).toBeNull() // loopback delivered the first frame synchronously
    expect(screen.getByTestId('shipping-status').textContent).toBe('active')
    const r0 = reserveRenders
    const s0 = shippingRenders

    await act(async () => {
      screen.getByText('fill').click()
      await tick()
    })
    expect(screen.getByTestId('shipping-address').textContent).toBe('Main St')
    expect(shippingRenders).toBeGreaterThan(s0)
    expect(reserveRenders).toBe(r0) // structural sharing across frames keeps the reserve slice identical

    await act(async () => {
      screen.getByText('next').click()
      await tick()
    })
    expect(screen.getByTestId('reserve-status').textContent).toBe('active:1')
    expect(screen.getByTestId('status').textContent).toBe('running/none')
    await act(async () => {
      release()
      await tick()
    })
    expect(screen.getByTestId('reserve-status').textContent).toBe('done:1')
    expect(screen.getByTestId('status').textContent).toBe('done/none')
    expect(mirror.getSnapshot()?.steps.reserve.output).toEqual({ reservationId: 'res-c1' })
    mirror.dispose()
    run.dispose()
  })

  it('renders the fallback until the first frame arrives, then the children', async () => {
    const sched = createTestScheduler()
    const run = makeRun()
    await run.start()
    const source = createMirrorSource(run, checkoutClient)
    const transport = createLocalTransport(source, { delayMs: 100, scheduler: sched })
    const mirror: Mirror<typeof checkoutClient> = createMirror({ transport })
    render(
      <owMirror.Provider source={mirror} fallback={<p>connecting</p>}>
        <Status.mirror />
      </owMirror.Provider>,
    )
    expect(screen.getByText('connecting')).toBeTruthy()
    expect(screen.queryByTestId('status')).toBeNull()
    act(() => {
      sched.advance(100)
    })
    expect(screen.queryByText('connecting')).toBeNull()
    expect(screen.getByTestId('status').textContent).toBe('waiting/shipping')
    mirror.dispose()
    run.dispose()
  })

  it('actions resolve with the ack result (CommandResult) and useStep helpers are bound to the step', async () => {
    const { run, mirror } = await makeMirror()
    let helpers: ReturnType<typeof owMirror.useStep<'shipping'>> | undefined
    function Probe() {
      helpers = owMirror.useStep('shipping')
      return null
    }
    render(
      <owMirror.Provider source={mirror}>
        <Probe />
      </owMirror.Provider>,
    )
    if (helpers === undefined) throw new Error('not rendered')
    let result: unknown
    await act(async () => {
      result = await helpers?.setInput({ address: 'Elm St', express: true })
    })
    expect(result).toMatchObject({ ok: true })
    expect(run.getState().steps.shipping.input).toEqual({ address: 'Elm St', express: true })
    await act(async () => {
      result = await helpers?.resetInput()
    })
    expect(run.getState().steps.shipping.input).toBeUndefined()
    await act(async () => {
      result = await helpers?.next()
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await act(async () => {
      result = await helpers?.go()
    })
    expect(result).toHaveProperty('ok') // go() targets this view; the machine decides
    mirror.dispose()
    run.dispose()
  })

  it('StrictMode: no listener leaks after unmount, and replacing the Provider source unsubscribes the old one', async () => {
    const { run, mirror } = await makeMirror()
    const state = mirror.getSnapshot()
    if (state === null) throw new Error('no frame')
    // Fake Mirror-like sources that count their listeners (only subscribe/getSnapshot are read here).
    const fake = () => {
      const listeners = new Set<() => void>()
      const source = {
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        getSnapshot: () => state,
      } as unknown as Mirror<typeof checkoutClient>
      return { source, count: () => listeners.size }
    }
    const a = fake()
    const b = fake()
    const view = (source: Mirror<typeof checkoutClient>) => (
      <StrictMode>
        <owMirror.Provider source={source}>
          <Status.mirror />
        </owMirror.Provider>
      </StrictMode>
    )
    const { rerender, unmount } = render(view(a.source))
    expect(screen.getByTestId('status').textContent).toBe('waiting/shipping')
    expect(a.count()).toBeGreaterThan(0)
    rerender(view(b.source))
    expect(a.count()).toBe(0) // the old source is fully unsubscribed
    expect(b.count()).toBeGreaterThan(0)
    unmount()
    expect(b.count()).toBe(0)
    mirror.dispose()
    run.dispose()
  })
})
