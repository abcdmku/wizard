/**
 * `createMirror` as a UI client: optimistic `setInput` drafts (controlled inputs keep every
 * keystroke through a laggy wire), connection state + reconnect on the same Mirror, and a
 * Mirror seeded with the server's `initial` frame (server rendering, no transport).
 */
import { describe, expect, it } from 'vitest'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { checkoutClient, makeRun, tick } from './fixture'

async function laggyLoop() {
  const sched = createTestScheduler()
  const run = makeRun()
  await run.start()
  const source = createMirrorSource(run, checkoutClient)
  const transport = createLocalTransport(source, { delayMs: 20, scheduler: sched, serialize: true })
  const mirror = createMirror<typeof checkoutClient>({ transport })
  sched.advance(20)
  /** Let every hop (command → source → ack / frame) through. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await tick()
      sched.advance(20)
    }
    await tick()
  }
  return { run, source, mirror, settle }
}

describe('createMirror: optimistic drafts', () => {
  it('shows each setInput at once, keeps later keystrokes over older frames, and ends on the server state', async () => {
    const { run, mirror, settle } = await laggyLoop()
    const address = () => mirror.getSnapshot()?.steps.shipping.input?.address
    // A controlled input: each keystroke appends to what the box shows right now.
    void mirror.setInput('shipping', { address: `${address() ?? ''}A` })
    const afterFirst = address()
    void mirror.setInput('shipping', { address: `${address() ?? ''}d` })
    const afterSecond = address()
    await settle()
    expect({
      afterFirst,
      afterSecond,
      settled: address(),
      server: run.getState().steps.shipping.input,
    }).toEqual({
      afterFirst: 'A',
      afterSecond: 'Ad',
      settled: 'Ad',
      server: { address: 'Ad' },
    })
    run.dispose()
  })

  it('drops a draft the server rejects, back to the frame state', async () => {
    const { run, mirror, settle, source } = await laggyLoop()
    source.dispose() // the server answers DISPOSED to everything from now on
    const pending = mirror.setInput('shipping', { address: 'x' })
    const optimistic = mirror.getSnapshot()?.steps.shipping.input
    await settle()
    expect({
      optimistic,
      result: await pending,
      after: mirror.getSnapshot()?.steps.shipping.input,
    }).toEqual({
      optimistic: { address: 'x' },
      result: { ok: false, code: 'DISPOSED', message: 'mirror source is disposed' },
      after: undefined,
    })
    run.dispose()
  })
})

describe('createMirror: connection', () => {
  it('goes disconnected when the transport closes and reconnects on the same Mirror', async () => {
    const run = makeRun()
    await run.start()
    let source = createMirrorSource(run, checkoutClient)
    const mirror = createMirror<typeof checkoutClient>({ transport: createLocalTransport(source) })
    const seen: boolean[] = []
    mirror.subscribe(() => seen.push(mirror.connected))
    const before = mirror.connected
    source.dispose() // the server side of the stream goes away
    const dropped = mirror.connected
    source = createMirrorSource(run, checkoutClient)
    mirror.connect(createLocalTransport(source))
    await mirror.setInput('shipping', { address: 'back' })
    expect({
      before,
      dropped,
      seen: seen.slice(0, 2),
      after: mirror.connected,
      input: mirror.getSnapshot()?.steps.shipping.input,
    }).toEqual({
      before: true,
      dropped: false,
      seen: [false, true],
      after: true,
      input: { address: 'back' },
    })
    run.dispose()
  })

  it('an initial frame gives state before any transport; commands then answer TRANSPORT_FAILED', async () => {
    const run = makeRun()
    await run.start()
    const source = createMirrorSource(run, checkoutClient)
    const initial = JSON.parse(JSON.stringify(source.getFrame()))
    const server = createMirror<typeof checkoutClient>({ initial })
    expect({
      current: server.getSnapshot()?.current,
      seq: server.seq,
      connected: server.connected,
      next: await server.next(),
    }).toEqual({
      current: 'shipping',
      seq: run.getState().seq,
      connected: false,
      next: {
        ok: false,
        code: 'TRANSPORT_FAILED',
        message: 'mirror has no transport (pass one to createMirror or mirror.connect)',
      },
    })
    run.dispose()
  })
})
