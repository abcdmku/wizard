/**
 * `createMirror` — the end-to-end loop `createWizard` → `createMirrorSource` → `createLocalTransport` → `createMirror` (latency, serialisation, hostile ids, select projections).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror, type Mirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import type { Transport } from '../../src/mirror/transport'
import type { Frame } from '../../src/mirror/wire'
import { defineProjection, type ProjectionOutput } from '../../src/projection/define-projection'
import { createWizard } from '../../src/wizard/create-wizard'
import { checkout, checkoutClient, makeWizard, tick } from './fixture'

type State = ProjectionOutput<typeof checkoutClient>

describe('createMirror: end to end through the loopback', () => {
  function loop(options: Parameters<typeof createLocalTransport>[1] = {}) {
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source, options)
    const mirror: Mirror<typeof checkoutClient> = createMirror({ transport })
    return { wizard, source, transport, mirror }
  }

  it('drives a real wizard view → task → final through the mirror; the mirror never sees unexposed fields', async () => {
    const { wizard, mirror, source } = loop()
    expect(mirror.connected).toBe(true) // the loopback delivers the initial frame synchronously
    expect(mirror.getSnapshot()?.status).toBe('idle')
    const frames: number[] = []
    mirror.subscribe(() => frames.push(mirror.seq ?? -1))

    expect(await mirror.dispatch({ type: 'start' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.current).toBe('shipping')

    // Invalid draft → INVALID_INPUT with issues visible through the projection.
    const rejected = await mirror.next()
    expect(rejected).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(mirror.getSnapshot()?.steps.shipping.issues?.length).toBeGreaterThan(0)

    expect(await mirror.setInput('shipping', { address: 'Main St' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.shipping.input).toEqual({ address: 'Main St' })
    expect(await mirror.next()).toMatchObject({ ok: true })
    await tick()
    const done = mirror.getSnapshot()
    expect(done?.status).toBe('done')
    expect(done?.steps.reserve.output).toEqual({ reservationId: 'res-c1' })
    expect(done?.output).toEqual({ cartId: 'c1' })
    expect(done?.context).toEqual({ total: 10, express: false })
    const json = JSON.stringify(done)
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('cartId":"c1","total') // raw context never crosses
    expect('output' in (done?.steps.shipping ?? {})).toBe(false) // not exposed
    expect(Object.keys(done ?? {}).sort()).toEqual(
      ['context', 'current', 'epoch', 'instanceId', 'output', 'seq', 'status', 'steps'].sort(),
    )
    // Every frame applied in seq order, no gaps backwards.
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
    expect(mirror.seq).toBe(wizard.getState().seq)
    mirror.dispose()
    source.dispose()
    wizard.dispose()
  })

  it('optimisticConcurrency: a command sent against a stale seq is answered STALE and the next frame resyncs', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source)
    // A "slow" client: it receives the first frame, then its frames stall.
    const stalled: Transport<State> = {
      subscribe(onFrame) {
        let first = true
        return transport.subscribe((f) => {
          if (first) {
            first = false
            onFrame(f)
          }
        })
      },
      send: (command) => transport.send(command),
    }
    const slow = createMirror<typeof checkoutClient>({
      transport: stalled,
      optimisticConcurrency: true,
    })
    const live = createMirror<typeof checkoutClient>({ transport, optimisticConcurrency: true })
    expect(await live.setInput('shipping', { address: 'x' })).toMatchObject({ ok: true })
    expect(await slow.setInput('shipping', { address: 'y' })).toMatchObject({
      ok: false,
      code: 'STALE',
    })
    expect(wizard.getState().steps.shipping.input).toEqual({ address: 'x' })
    // The live mirror moved with the frame, so its optimistic command goes through.
    expect(await live.setInput('shipping', { express: true })).toMatchObject({ ok: true })
    // Without optimistic concurrency the slow client's command is accepted (last write wins).
    const plain = createMirror<typeof checkoutClient>({ transport: stalled })
    expect(await plain.setInput('shipping', { address: 'z' })).toMatchObject({ ok: true })
    wizard.dispose()
  })

  it('deterministic latency: frames and acks travel through the injected scheduler; serialize decouples objects', async () => {
    const sched = createTestScheduler()
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source, {
      delayMs: 50,
      scheduler: sched,
      serialize: true,
    })
    const mirror = createMirror<typeof checkoutClient>({ transport })
    expect(mirror.getSnapshot()).toBeNull() // initial frame is in flight
    sched.advance(50)
    expect(mirror.getSnapshot()?.status).toBe('idle')
    expect(mirror.getSnapshot()).not.toBe(wizard.project(checkoutClient)) // a copy, not the wizard's object

    let result: unknown
    const pending = mirror.dispatch({ type: 'start' }).then((r) => {
      result = r
    })
    await tick()
    expect(wizard.getState().current).toBeNull() // command still in flight
    sched.advance(50) // command reaches the source
    await tick()
    expect(wizard.getState().current).toBe('shipping')
    expect(result).toBeUndefined() // ack still in flight
    expect(mirror.getSnapshot()?.current).toBeNull() // frame still in flight
    sched.advance(50)
    await pending
    expect(result).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.current).toBe('shipping')
    wizard.dispose()
  })

  it('unsubscribing the loopback drops frames that were still in flight', () => {
    const sched = createTestScheduler()
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    const transport = createLocalTransport(source, { delayMs: 10, scheduler: sched })
    const frames: Frame<unknown>[] = []
    const unsubscribe = transport.subscribe((f) => frames.push(f))
    unsubscribe()
    sched.advance(10)
    expect(frames).toHaveLength(0)
    wizard.dispose()
  })

  it("step ids named '__proto__' and 'constructor' survive the whole loop (serialized transport included)", async () => {
    const r = defineFlow({
      name: 'reserved-ids',
      context: boundary.trusted<Record<string, never>>(),
    })
    const reserved = r.steps(
      {
        ['__proto__']: r.view({ input: z.object({ v: z.string() }), next: 'constructor' }),
        constructor: r.task(() => 'built', { next: 'end' }),
        end: r.final({ output: () => 'ok' }),
      },
      { start: '__proto__' },
    )
    const projection = defineProjection(reserved, {
      expose: { steps: { ['__proto__']: { input: true }, constructor: { output: true } } },
    })
    const wizard = createWizard(reserved, { context: {}, instanceId: 'wiz-r' })
    const source = createMirrorSource(wizard, projection)
    const mirror = createMirror<typeof projection>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    expect(Object.keys(mirror.getSnapshot()?.steps ?? {}).sort()).toEqual(
      ['__proto__', 'constructor', 'end'].sort(),
    )
    expect(Object.hasOwn(mirror.getSnapshot()?.steps ?? {}, '__proto__')).toBe(true)
    expect(await mirror.start()).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.current).toBe('__proto__')
    expect(await mirror.setInput('__proto__', { v: 'x' })).toMatchObject({ ok: true })
    const steps = mirror.getSnapshot()?.steps
    const own = (key: string): unknown => Object.getOwnPropertyDescriptor(steps, key)?.value
    expect(own('__proto__')).toMatchObject({ id: '__proto__', input: { v: 'x' } })
    expect(Object.getPrototypeOf(steps)).toBe(Object.prototype) // never rewired
    expect(await mirror.next()).toMatchObject({ ok: true })
    await tick()
    expect(mirror.getSnapshot()?.status).toBe('done')
    expect(mirror.getSnapshot()?.steps.constructor.output).toBe('built')
    // Commands addressed to those ids decode against the flow like any other id.
    expect(await mirror.go('__proto__')).toHaveProperty('ok')
    expect(await mirror.retry('constructor')).toHaveProperty('ok')
    // The persisted shape is plain JSON with own keys.
    const json = JSON.parse(JSON.stringify(wizard.getSnapshot())) as {
      state: { steps: Record<string, unknown> }
    }
    expect(Object.hasOwn(json.state.steps, '__proto__')).toBe(true)
    wizard.dispose()
  })

  it('select projections whose state is a primitive, an array or null travel through the (serialized) loop frame by frame', async () => {
    const wizard = makeWizard()
    const currentView = defineProjection(checkout, { select: (s) => s.current })
    const activeSteps = defineProjection(checkout, { select: (s) => s.active })
    const nil = defineProjection(checkout, { select: () => null })
    const serialized = { serialize: true }
    const current = createMirror<typeof currentView>({
      transport: createLocalTransport(createMirrorSource(wizard, currentView), serialized),
    })
    const active = createMirror<typeof activeSteps>({
      transport: createLocalTransport(createMirrorSource(wizard, activeSteps), serialized),
    })
    const nothing = createMirror<typeof nil>({
      transport: createLocalTransport(createMirrorSource(wizard, nil), serialized),
    })
    expect(current.getSnapshot()).toBeNull() // the projected value IS null before start
    expect(active.getSnapshot()).toEqual([])
    await wizard.start()
    expect(current.getSnapshot()).toBe('shipping')
    expect(active.getSnapshot()).toEqual(['shipping'])
    expect(nothing.getSnapshot()).toBeNull()
    // Every frame was applied (not ignored): the mirrors follow the wizard's seq.
    for (const m of [current, active, nothing]) expect(m.seq).toBe(wizard.getState().seq)
    expect(await current.setInput('shipping', { address: 'Main St' })).toMatchObject({ ok: true })
    expect(await current.next()).toMatchObject({ ok: true })
    await tick()
    expect(current.getSnapshot()).toBeNull()
    expect(active.getSnapshot()).toEqual([])
    expect(nothing.seq).toBe(wizard.getState().seq)
    wizard.dispose()
  })
})
