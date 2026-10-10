/**
 * Headless run of the whole example: the "server" (wizard + source + serialized loopback), the
 * client Mirror and the React UI, driven through the DOM only. Proves the flow works end to end,
 * that the UI never needs the wizard, and that no card number ever reaches the wizard: what
 * crosses `setInput` is the provider token.
 */
import { createTestScheduler } from '@openwizard/core/testing'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { createClient } from './client'
import type { CheckoutDeps } from './flow'
import { startServer } from './server'

afterEach(cleanup)

/** Instant fakes: `reserve` still fails once so the retry path is exercised. */
function instantDeps(log: string[]): CheckoutDeps {
  let reserves = 0
  return {
    inventory: {
      reserve: async (cartId) => {
        reserves += 1
        log.push(`reserve:${cartId}:${reserves}`)
        if (reserves === 1) throw new Error('warehouse timeout (simulated)')
        return { reservationId: `rsv_${cartId}` }
      },
    },
    payments: {
      charge: async (token, amount) => {
        log.push(`charge:${token}:${amount}`)
        return { chargeId: `ch_${token}` }
      },
    },
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('08 react + mirror: the UI drives the wizard through the Mirror only', () => {
  it('shipping → payment (tokenised card) → reserve (retried) → charge → receipt', async () => {
    const log: string[] = []
    const sched = createTestScheduler({ now: 0 })
    const { transport, wizard } = startServer({
      deps: instantDeps(log),
      delayMs: 0,
      scheduler: sched,
    })
    const mirror = createClient(transport)
    render(<App mirror={mirror} />)

    // Shipping form, validated by the Zod boundary through the wire door.
    expect(screen.getByRole('heading', { name: 'Shipping' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    await waitFor(() => expect(screen.getByText('Name needs at least 2 characters')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Analytical Way' } })
    fireEvent.click(screen.getByLabelText('Express delivery'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Payment' })).toBeTruthy())
    expect(wizard.getState().current).toBe('payment')

    // Payment: a bad card never leaves the browser (tokenisation fails locally).
    fireEvent.change(screen.getByLabelText('Card number'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }))
    await waitFor(() => expect(screen.getByText('Card number must be 16 digits')).toBeTruthy())
    expect(wizard.getState().steps.payment.input).toBeUndefined()

    // A good card is tokenised by the provider stub; only the token reaches the wizard.
    fireEvent.click(screen.getByRole('button', { name: 'Use a test card' }))
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }))
    await waitFor(() => expect(wizard.getState().current).not.toBe('payment'), { timeout: 3000 })
    const snapshotJson = JSON.stringify(wizard.getSnapshot())
    expect(snapshotJson).not.toContain('4242424242424242')
    expect(snapshotJson).toMatch(/tok_[a-z0-9]+/)
    expect(wizard.getState().steps.payment.output).toMatchObject({ last4: '4242' })

    // Tasks: reserve fails once (visible error), the retry timer fires, then charge, then the receipt.
    await waitFor(() => expect(screen.getByText(/warehouse timeout/)).toBeTruthy())
    expect(wizard.getState().steps.reserve.status).toBe('active')
    await act(async () => {
      sched.advance(400) // the retry timer
      await tick()
    })
    await waitFor(
      () => expect(screen.getByRole('heading', { name: /Thank you, Ada Lovelace/ })).toBeTruthy(),
      {
        timeout: 3000,
      },
    )
    expect(log).toEqual([
      'reserve:cart-42:1',
      'reserve:cart-42:2',
      expect.stringMatching(/^charge:tok_[a-z0-9]+:129\.5$/),
    ])
    expect(screen.getByText('Express')).toBeTruthy()
    expect(wizard.getState().status).toBe('done')
    // The mirror shows the same base facts as the wizard, and nothing it should not see.
    const view = mirror.getSnapshot()
    expect(view?.status).toBe('done')
    expect(view?.output).toMatchObject({ customer: 'Ada Lovelace', express: true, total: 129.5 })
    expect(view?.context).toEqual({ total: 129.5, express: true }) // cartId is not exposed
    mirror.dispose()
    wizard.dispose()
  })

  it('cancel while the tasks run', async () => {
    const log: string[] = []
    const deps = instantDeps(log)
    // A reserve that never resolves keeps the flow "running" so the cancel button is visible.
    deps.inventory.reserve = () => new Promise(() => {})
    const { transport, wizard } = startServer({ deps, delayMs: 0 })
    const mirror = createClient(transport)
    render(<App mirror={mirror} />)
    await mirror.setInput('shipping', { name: 'Grace', address: 'Somewhere far away' })
    await mirror.next()
    await mirror.setInput('payment', { paymentToken: 'tok_test', last4: '4242' })
    await mirror.next()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Order (cancelled|compensating)/ })).toBeTruthy(),
    )
    await waitFor(() => expect(wizard.getState().status).toBe('cancelled'))
    mirror.dispose()
    wizard.dispose()
  })
})
