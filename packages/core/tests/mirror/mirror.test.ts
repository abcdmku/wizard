/**
 * `createMirror` — frame ordering rules (§8.9), structural sharing, command sugar → wire
 * commands, and the end-to-end loop `createWizard` → `createMirrorSource` →
 * `createLocalTransport` → `createMirror` (including deterministic latency + serialisation).
 */
import { describe, expect, it } from 'vitest'
import { WizardError } from '../../src/errors'
import { createSequentialIds } from '../../src/interpreter/env'
import { createMirror } from '../../src/mirror/create-mirror'
import type { Transport } from '../../src/mirror/transport'
import type { Frame, WireAck, WireCommand } from '../../src/mirror/wire'
import type { ProjectionOutput } from '../../src/projection/define-projection'
import type { checkoutClient } from './fixture'

type State = ProjectionOutput<typeof checkoutClient>

/** A scripted transport: the test pushes frames and records sent commands. */
function fakeTransport(initial?: Frame<State>) {
  const listeners = new Set<(f: Frame<State>) => void>()
  const sent: WireCommand[] = []
  let ackWith: (cmd: WireCommand) => WireAck = (cmd) => ({
    commandId: cmd.commandId,
    result: { ok: true, seq: 99 },
    seq: 99,
  })
  const transport: Transport<State> = {
    subscribe(onFrame) {
      listeners.add(onFrame)
      if (initial !== undefined) onFrame(initial)
      return () => {
        listeners.delete(onFrame)
      }
    },
    async send(command) {
      sent.push(command)
      return ackWith(command)
    },
  }
  return {
    transport,
    sent,
    push: (f: Frame<State>) => {
      for (const l of listeners) l(f)
    },
    ack: (fn: typeof ackWith) => {
      ackWith = fn
    },
    listenerCount: () => listeners.size,
  }
}

const frame = (
  seq: number,
  epoch = 0,
  patch: Partial<State> = {},
  instanceId = 'wiz-1',
): Frame<State> =>
  ({
    kind: 'snapshot',
    instanceId,
    epoch,
    seq,
    state: {
      instanceId,
      epoch,
      seq,
      status: 'waiting',
      current: 'shipping',
      context: { total: 10, express: false },
      steps: {
        shipping: {
          id: 'shipping',
          kind: 'view',
          status: 'active',
          attempt: 0,
          input: { address: 'a' },
        },
        reserve: { id: 'reserve', kind: 'task', status: 'idle', attempt: 0 },
        receipt: { id: 'receipt', kind: 'final', status: 'idle', attempt: 0 },
      },
      ...patch,
    },
  }) as Frame<State>

describe('createMirror: frames', () => {
  it('starts empty, applies the first frame, notifies subscribers, exposes ids', () => {
    const t = fakeTransport()
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    expect(mirror.getSnapshot()).toBeNull()
    expect(mirror.connected).toBe(false)
    expect(mirror.instanceId).toBeNull()
    expect(mirror.epoch).toBeNull()
    expect(mirror.seq).toBeNull()
    let notified = 0
    mirror.subscribe(() => {
      notified += 1
    })
    t.push(frame(3))
    expect(notified).toBe(1)
    expect(mirror.connected).toBe(true)
    expect(mirror.instanceId).toBe('wiz-1')
    expect(mirror.epoch).toBe(0)
    expect(mirror.seq).toBe(3)
    expect(mirror.getSnapshot()?.current).toBe('shipping')
    expect(mirror.getSnapshot()).toBe(mirror.getSnapshot()) // stable identity
  })

  it('ignores duplicate and out-of-order frames of the same epoch (no notification, same identity)', () => {
    const t = fakeTransport(frame(5))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    const s5 = mirror.getSnapshot()
    let notified = 0
    mirror.subscribe(() => {
      notified += 1
    })
    t.push(frame(5, 0, { status: 'done' })) // duplicate seq
    t.push(frame(4, 0, { status: 'done' })) // older
    expect(notified).toBe(0)
    expect(mirror.getSnapshot()).toBe(s5)
    expect(mirror.seq).toBe(5)
    t.push(frame(6, 0, { status: 'done' }))
    expect(notified).toBe(1)
    expect(mirror.seq).toBe(6)
    expect(mirror.getSnapshot()?.status).toBe('done')
  })

  it('an epoch change resets local state even with a lower seq', () => {
    const t = fakeTransport(frame(10))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    const before = mirror.getSnapshot()
    t.push(frame(2, 1, { status: 'running' }))
    expect(mirror.epoch).toBe(1)
    expect(mirror.seq).toBe(2)
    expect(mirror.getSnapshot()).not.toBe(before)
    expect(mirror.getSnapshot()?.status).toBe('running')
    // Unchanged slices are NOT shared across an epoch reset (fresh objects).
    expect(mirror.getSnapshot()?.steps.reserve).not.toBe(before?.steps.reserve)
    // Back to epoch 0 is older → ignored.
    t.push(frame(11, 0))
    expect(mirror.epoch).toBe(1)
  })

  it('a frame from another instance is applied as a reset; the previous instance is retired (A → B → late A is ignored)', () => {
    const t = fakeTransport(frame(10))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    t.push(frame(1, 0, {}, 'wiz-2'))
    expect(mirror.instanceId).toBe('wiz-2')
    expect(mirror.seq).toBe(1)
    let notified = 0
    mirror.subscribe(() => {
      notified += 1
    })
    // A delayed frame of the retired instance A — even a "newer" one — cannot flip the mirror back.
    t.push(frame(11, 0, {}, 'wiz-1'))
    t.push(frame(1, 5, {}, 'wiz-1'))
    expect(mirror.instanceId).toBe('wiz-2')
    expect(mirror.seq).toBe(1)
    expect(notified).toBe(0)
    // B keeps flowing.
    t.push(frame(2, 0, { status: 'done' }, 'wiz-2'))
    expect(mirror.seq).toBe(2)
    expect(mirror.getSnapshot()?.status).toBe('done')
    expect(notified).toBe(1)
  })

  it('ignores malformed frames and frames whose state facts do not match the envelope (parseFrame)', () => {
    const t = fakeTransport(frame(1))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    const s1 = mirror.getSnapshot()
    let notified = 0
    mirror.subscribe(() => {
      notified += 1
    })
    const bad: unknown[] = [
      null,
      'frame',
      { ...frame(2), kind: 'delta' },
      { ...frame(2), seq: '2' },
      { ...frame(2), epoch: -1 },
      { ...frame(2), instanceId: '' },
      { ...frame(2), extra: true },
      { ...frame(2), state: { ...frame(2).state, seq: 99 } }, // envelope/state mismatch
      { ...frame(2), state: { ...frame(2).state, instanceId: 'other' } },
    ]
    for (const f of bad) t.push(f as Frame<State>)
    expect(notified).toBe(0)
    expect(mirror.getSnapshot()).toBe(s1)
    expect(mirror.seq).toBe(1)
    t.push(frame(2))
    expect(notified).toBe(1)
  })

  it('shares unchanged slices structurally across frames of the same epoch', () => {
    const t = fakeTransport(frame(1))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    const s1 = mirror.getSnapshot()
    t.push(
      frame(2, 0, {
        steps: {
          shipping: {
            id: 'shipping',
            kind: 'view',
            status: 'active',
            attempt: 0,
            input: { address: 'b' },
          },
          reserve: { id: 'reserve', kind: 'task', status: 'idle', attempt: 0 },
          receipt: { id: 'receipt', kind: 'final', status: 'idle', attempt: 0 },
        },
      } as Partial<State>),
    )
    const s2 = mirror.getSnapshot()
    expect(s2).not.toBe(s1)
    expect(s2?.steps).not.toBe(s1?.steps)
    expect(s2?.steps.shipping).not.toBe(s1?.steps.shipping)
    expect(s2?.steps.shipping.input).toEqual({ address: 'b' })
    expect(s2?.steps.reserve).toBe(s1?.steps.reserve) // unchanged → same reference
    expect(s2?.steps.receipt).toBe(s1?.steps.receipt)
    expect(s2?.context).toBe(s1?.context)
    // A frame whose state is deep-equal (only seq moved) keeps every slice.
    t.push(frame(3, 0, { steps: s2?.steps } as Partial<State>))
    const s3 = mirror.getSnapshot()
    expect(s3?.steps).toBe(s2?.steps)
    expect(s3?.seq).toBe(3)
  })

  it('dispose() unsubscribes, notifies once, drops later frames; subscribe() is then a no-op', () => {
    const t = fakeTransport(frame(1))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    let notified = 0
    mirror.subscribe(() => {
      notified += 1
    })
    expect(t.listenerCount()).toBe(1)
    mirror.dispose()
    mirror.dispose()
    expect(t.listenerCount()).toBe(0)
    expect(notified).toBe(1)
    expect(mirror.connected).toBe(false)
    expect(mirror.getSnapshot()?.seq).toBe(1) // last state stays readable
    let late = 0
    const unsubscribe = mirror.subscribe(() => {
      late += 1
    })
    expect(typeof unsubscribe).toBe('function')
    t.push(frame(2))
    unsubscribe()
    expect(late).toBe(0)
  })
})

describe('createMirror: commands', () => {
  it('builds wire commands with fresh ids and the last frame instance id; expectedSeq only when opted in', async () => {
    const t = fakeTransport(frame(7))
    const mirror = createMirror<typeof checkoutClient>({
      transport: t.transport,
      ids: createSequentialIds(),
    })
    expect(await mirror.next()).toEqual({ ok: true, seq: 99 })
    expect(await mirror.setInput('shipping', { address: 'x' })).toEqual({ ok: true, seq: 99 })
    await mirror.go('shipping')
    await mirror.back()
    await mirror.resetInput('shipping')
    await mirror.send('payment.captured', { paymentId: 'p' })
    await mirror.retry('reserve')
    await mirror.cancel()
    await mirror.cancel('why')
    await mirror.runReady()
    await mirror.dispatch({ type: 'compensate', from: 'reserve' })
    await mirror.start()
    await mirror.run('reserve')
    await mirror.reset()
    await mirror.compensate()
    await mirror.compensate({ from: 'reserve', reason: 'ops' })
    await mirror.send('payment.captured', { paymentId: 'p' }, { correlationId: 'corr-1' })
    expect(t.sent.map((c) => c.command)).toEqual([
      { type: 'next' },
      { type: 'setInput', step: 'shipping', patch: { address: 'x' } },
      { type: 'go', step: 'shipping' },
      { type: 'back' },
      { type: 'resetInput', step: 'shipping' },
      { type: 'send', event: 'payment.captured', payload: { paymentId: 'p' } },
      { type: 'retry', step: 'reserve' },
      { type: 'cancel' },
      { type: 'cancel', reason: 'why' },
      { type: 'runReady' },
      { type: 'compensate', from: 'reserve' },
      { type: 'start' },
      { type: 'run', step: 'reserve' },
      { type: 'reset' },
      { type: 'compensate' },
      { type: 'compensate', from: 'reserve', reason: 'ops' },
      {
        type: 'send',
        event: 'payment.captured',
        payload: { paymentId: 'p' },
        correlationId: 'corr-1',
      },
    ])
    expect(t.sent.map((c) => c.commandId)).toEqual(t.sent.map((_, i) => `cmd_${i + 1}`))
    expect(t.sent.every((c) => c.instanceId === 'wiz-1' && !('expectedSeq' in c))).toBe(true)

    const optimistic = createMirror<typeof checkoutClient>({
      transport: t.transport,
      optimisticConcurrency: true,
    })
    await optimistic.next()
    expect(t.sent.at(-1)).toMatchObject({ expectedSeq: 7 })
  })

  it('answers INVALID_COMMAND before the first frame and DISPOSED after dispose (nothing sent)', async () => {
    const t = fakeTransport()
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    expect(await mirror.next()).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    t.push(frame(1))
    mirror.dispose()
    expect(await mirror.next()).toMatchObject({ ok: false, code: 'DISPOSED' })
    expect(t.sent).toHaveLength(0)
  })

  it('returns the ack result as-is and propagates transport rejections', async () => {
    const t = fakeTransport(frame(1))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    t.ack((cmd) => ({
      commandId: cmd.commandId,
      result: { ok: false, code: 'STALE', message: 'moved' },
      seq: 2,
    }))
    expect(await mirror.next()).toEqual({ ok: false, code: 'STALE', message: 'moved' })
    t.ack(() => {
      throw new Error('network down')
    })
    await expect(mirror.next()).rejects.toThrow('network down')
  })

  it('rejects an ack for another command or a malformed ack (WizardError INVALID_COMMAND); state is untouched', async () => {
    const t = fakeTransport(frame(1))
    const mirror = createMirror<typeof checkoutClient>({ transport: t.transport })
    const before = mirror.getSnapshot()
    t.ack(() => ({ commandId: 'someone-else', result: { ok: true, seq: 5 }, seq: 5 }))
    await expect(mirror.next()).rejects.toMatchObject({
      name: 'WizardError',
      code: 'INVALID_COMMAND',
      message: expect.stringMatching(/ack for command 'someone-else'/),
    })
    t.ack(() => ({}) as WireAck)
    await expect(mirror.next()).rejects.toBeInstanceOf(WizardError)
    t.ack((cmd) => ({ commandId: cmd.commandId, result: 'ok', seq: 1 }) as unknown as WireAck)
    await expect(mirror.next()).rejects.toMatchObject({ code: 'INVALID_COMMAND' })
    expect(mirror.getSnapshot()).toBe(before)
    expect(mirror.seq).toBe(1)
  })
})
