/**
 * `bindReact<typeof projection>()` over a Mirror — loopback rendering, fallback until the first
 * frame, ack results, StrictMode listener leaks, SSR / hydration with `serverSnapshot`.
 */
import { createMirror, createMirrorSource, type Mirror } from '@openwizard/core'
import { createLocalTransport, createTestScheduler } from '@openwizard/core/testing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindReact } from '../src/index'
import {
  type checkout,
  checkoutClient,
  controlledDeps,
  makeMirror,
  makeWizard,
  tick,
} from './fixture'

afterEach(cleanup)

/** Server HTML without React's text-node separators (`<!-- -->`). */
const text = (html: string): string => html.replace(/<!--.*?-->/g, '')

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

describe('bindReact over a Mirror', () => {
  it('drives the flow through the loopback; the projected state is what the hooks see', async () => {
    const { deps, release } = controlledDeps()
    const { wizard, mirror } = await makeMirror(deps)
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
    wizard.dispose()
  })

  it('renders the fallback until the first frame arrives, then the children', async () => {
    const sched = createTestScheduler()
    const wizard = makeWizard()
    await wizard.start()
    const source = createMirrorSource(wizard, checkoutClient)
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
    wizard.dispose()
  })

  it('actions resolve with the ack result (CommandResult) and useStep helpers are bound to the step', async () => {
    const { wizard, mirror } = await makeMirror()
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
    expect(wizard.getState().steps.shipping.input).toEqual({ address: 'Elm St', express: true })
    await act(async () => {
      result = await helpers?.resetInput()
    })
    expect(wizard.getState().steps.shipping.input).toBeUndefined()
    await act(async () => {
      result = await helpers?.next()
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await act(async () => {
      result = await helpers?.go()
    })
    expect(result).toHaveProperty('ok') // go() targets this view; the machine decides
    mirror.dispose()
    wizard.dispose()
  })

  it('StrictMode: no listener leaks after unmount, and replacing the Provider source unsubscribes the old one', async () => {
    const { wizard, mirror } = await makeMirror()
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
    wizard.dispose()
  })

  it('SSR: `serverSnapshot` renders on the server and hydrates without a mismatch even when the live source already moved on', async () => {
    const wizard = makeWizard()
    await wizard.start()
    // What the server rendered with (captured while the mirror still sat at `shipping`).
    const serverSnapshot = wizard.project(checkoutClient)
    const sched = createTestScheduler()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source, { delayMs: 100, scheduler: sched })
    const mirror: Mirror<typeof checkoutClient> = createMirror({ transport })
    const tree = (
      <owMirror.Provider
        source={mirror}
        serverSnapshot={serverSnapshot}
        fallback={<p>connecting</p>}
      >
        <Status.mirror />
      </owMirror.Provider>
    )
    // Server: no frame has arrived, yet the server snapshot renders the state.
    const html = renderToString(tree)
    expect(text(html)).toContain('waiting/shipping')
    expect(html).not.toContain('connecting')

    // Between server render and hydration the wizard moves on and the mirror catches up.
    await wizard.setInput('shipping', { address: 'Main St' })
    await wizard.next()
    await tick()
    act(() => {
      sched.advance(100)
    })
    expect(mirror.getSnapshot()?.status).toBe('done')

    // Client: hydrate the server HTML — no recoverable (mismatch) error, then the live state shows.
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const recoverable: unknown[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (e) => recoverable.push(e) })
    })
    expect(recoverable).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('done/none')
    act(() => {
      root?.unmount()
    })
    container.remove()
    mirror.dispose()
    wizard.dispose()
  })

  it('without `serverSnapshot` the server render uses the live source (fallback while a Mirror has no frame)', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const sched = createTestScheduler()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source, { delayMs: 100, scheduler: sched })
    const mirror: Mirror<typeof checkoutClient> = createMirror({ transport })
    expect(
      renderToString(
        <owMirror.Provider source={mirror} fallback={<p>connecting</p>}>
          <Status.mirror />
        </owMirror.Provider>,
      ),
    ).toContain('connecting')
    // A Wizard source has state right away.
    expect(
      text(
        renderToString(
          <owFlow.Provider source={wizard}>
            <Status.flow />
          </owFlow.Provider>,
        ),
      ),
    ).toContain('waiting/shipping')
    mirror.dispose()
    wizard.dispose()
  })
})
