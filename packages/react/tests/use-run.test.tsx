/**
 * `useRun(create, deps?)`: a component owns its run — created once, kept through StrictMode's
 * simulated remount, recreated when `deps` change, disposed after a real unmount.
 */
import type { Run } from '@openwizard/core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReact, useRun } from '../src/index'
import { checkoutFlow, instantDeps, makeRun, tick } from './fixture'

afterEach(cleanup)

const ow = bindReact<typeof checkoutFlow>()

function Status() {
  const status = ow.useSelector((s) => s.status)
  const total = ow.useSelector((s) => s.context.total)
  return (
    <p data-testid="status">
      {status}:{total}
    </p>
  )
}

describe('useRun', () => {
  it('StrictMode: creates the run once, keeps it through the simulated remount, disposes it after unmount', async () => {
    const created: Run<typeof checkoutFlow>[] = []
    const started: unknown[] = []
    function Checkout() {
      const run = useRun(() => {
        const fresh = makeRun()
        created.push(fresh)
        return fresh
      })
      useEffect(() => {
        void run.start().then((result) => started.push(result))
      }, [run])
      return (
        <ow.Provider source={run}>
          <Status />
        </ow.Provider>
      )
    }
    const { unmount } = render(
      <StrictMode>
        <Checkout />
      </StrictMode>,
    )
    await act(tick)
    expect(screen.getByTestId('status').textContent).toBe('waiting:10')
    expect(created).toHaveLength(1)
    expect(started).toEqual([
      { ok: true, seq: expect.any(Number) },
      { ok: false, code: 'INVALID_COMMAND', message: 'start: the run has already started' },
    ])
    const [run] = created
    unmount()
    expect(await run?.setInput('shipping', { address: 'x' })).toMatchObject({ ok: true })
    await tick()
    expect(await run?.setInput('shipping', { address: 'y' })).toMatchObject({
      ok: false,
      code: 'DISPOSED',
    })
  })

  it('creates a new run when a dependency changes and disposes the previous one', async () => {
    const created: Run<typeof checkoutFlow>[] = []
    function Checkout({ total }: { total: number }) {
      const run = useRun(() => {
        const fresh = checkoutFlow.create(
          { cartId: 'c1', total },
          {
            deps: instantDeps,
          },
        )
        created.push(fresh)
        return fresh
      }, [total])
      return (
        <ow.Provider source={run}>
          <Status />
        </ow.Provider>
      )
    }
    const { rerender } = render(<Checkout total={10} />)
    expect(screen.getByTestId('status').textContent).toBe('idle:10')
    rerender(<Checkout total={20} />)
    await act(tick)
    expect(screen.getByTestId('status').textContent).toBe('idle:20')
    expect(created).toHaveLength(2)
    expect(await created[0]?.start()).toMatchObject({ ok: false, code: 'DISPOSED' })
    expect(await created[1]?.start()).toMatchObject({ ok: true })
    created[1]?.dispose()
  })
})
