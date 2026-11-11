/**
 * A Mirror as the client of a server run, through the hooks: controlled inputs keep every
 * keystroke, commands resolve `TRANSPORT_FAILED` instead of rejecting, `useConnection()` follows
 * the transport, and server rendering with `createMirror({ initial })` hydrates without a
 * fallback flash.
 */
import type { ProjectionOutput } from '@openwizard/core'
import {
  createMirror,
  createMirrorSource,
  type SnapshotFrame,
  type Transport,
} from '@openwizard/core/mirror'
import { createLocalTransport } from '@openwizard/core/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReact, useRun } from '../src/index'
import { checkoutClient, makeRun, tick } from './fixture'

afterEach(cleanup)

type Client = ProjectionOutput<typeof checkoutClient>
const ow = bindReact<typeof checkoutClient>()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A started run, its Mirror source and the source's current frame as the wire carries it. */
async function serverRun() {
  const run = makeRun()
  await run.start()
  const source = createMirrorSource(run, checkoutClient)
  const frame = JSON.parse(JSON.stringify(source.getFrame())) as SnapshotFrame<Client>
  return { run, source, frame }
}

function AddressField() {
  const { input, setInput } = ow.useStep('shipping')
  return (
    <input
      aria-label="address"
      value={input?.address ?? ''}
      onChange={(event) => void setInput({ address: event.target.value })}
    />
  )
}

describe('bindReact over a Mirror client', () => {
  it('a controlled input keeps every keystroke while acks and frames are in flight', async () => {
    const { run, source, frame } = await serverRun()
    const transport = createLocalTransport(source, { delayMs: 5, serialize: true })
    const mirror = createMirror<typeof checkoutClient>({ initial: frame, transport })
    render(
      <ow.Provider source={mirror}>
        <AddressField />
      </ow.Provider>,
    )
    const field = () => screen.getByLabelText('address') as HTMLInputElement
    await act(async () => {
      fireEvent.change(field(), { target: { value: `${field().value}M` } })
    })
    expect(field().value).toBe('M')
    await act(async () => {
      fireEvent.change(field(), { target: { value: `${field().value}a` } })
    })
    expect(field().value).toBe('Ma')
    await act(() => wait(30))
    expect(field().value).toBe('Ma')
    expect(run.getState().steps.shipping.input).toEqual({ address: 'Ma' })
    mirror.dispose()
    run.dispose()
  })

  it('commands resolve TRANSPORT_FAILED when the transport is down (they never reject)', async () => {
    const { run, frame } = await serverRun()
    const offline: Transport<Client> = {
      subscribe: () => () => {},
      send: () => Promise.reject(new Error('offline')),
    }
    const mirror = createMirror<typeof checkoutClient>({ initial: frame, transport: offline })
    let next: (() => Promise<unknown>) | undefined
    function Continue() {
      next = ow.useStep('shipping').next
      return null
    }
    render(
      <ow.Provider source={mirror}>
        <Continue />
      </ow.Provider>,
    )
    let result: unknown
    await act(async () => {
      result = await next?.()
    })
    expect(result).toEqual({
      ok: false,
      code: 'TRANSPORT_FAILED',
      message: 'transport failed: offline',
    })
    mirror.dispose()
    run.dispose()
  })

  it('useConnection() re-renders when the transport drops and when connect() is back', async () => {
    const { run, source } = await serverRun()
    let drop: (() => void) | undefined
    const transport: Transport<Client> = {
      subscribe(onFrame, onClose) {
        drop = () => onClose?.()
        return source.subscribe(onFrame)
      },
      send: (command) => source.dispatch(command),
    }
    const mirror = createMirror<typeof checkoutClient>({ transport })
    function Banner() {
      const { connected, connect } = ow.useConnection()
      return (
        <button type="button" onClick={() => connect()}>
          {connected ? 'online' : 'offline'}
        </button>
      )
    }
    render(
      <ow.Provider source={mirror}>
        <Banner />
      </ow.Provider>,
    )
    expect(screen.getByRole('button').textContent).toBe('online')
    act(() => drop?.())
    expect(screen.getByRole('button').textContent).toBe('offline')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('online')
    mirror.dispose()
    run.dispose()
  })

  it('SSR: createMirror({ initial }) renders on the server and hydrates without a fallback flash; commands work at once', async () => {
    const { run, source, frame } = await serverRun()
    function Form() {
      return (
        <>
          <p>{ow.useStep('shipping').status}</p>
          <AddressField />
        </>
      )
    }
    const html = renderToString(
      <ow.Provider source={createMirror({ initial: frame })} fallback={<i>connecting</i>}>
        <Form />
      </ow.Provider>,
    )
    expect(html).toBe('<p>active</p><input aria-label="address" value=""/>')

    function App() {
      const mirror = useRun(() =>
        createMirror<typeof checkoutClient>({
          initial: frame,
          transport: createLocalTransport(source, { delayMs: 5 }),
        }),
      )
      return (
        <ow.Provider source={mirror} fallback={<i>connecting</i>}>
          <Form />
        </ow.Provider>
      )
    }
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const recoverable: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <App />, {
        onRecoverableError: (error) => recoverable.push(error),
      })
    })
    expect(recoverable).toEqual([])
    expect(container.innerHTML).toBe('<p>active</p><input aria-label="address" value="">')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('address'), { target: { value: 'Main St' } })
      await wait(20)
    })
    expect(run.getState().steps.shipping.input).toEqual({ address: 'Main St' })
    act(() => root?.unmount())
    await tick()
    container.remove()
    run.dispose()
  })
})
