/**
 * `createMirrorSource` — the dispatch gate (`expectedSeq`, ordering) and hostile input.
 */
/**
 * `createMirrorSource` — the server half: frames on subscribe + per commit, wire command gating
 * (`INVALID_COMMAND`, `STALE`, `DISPOSED`), acks with the post-command seq, projection check.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirrorSource } from '../../src/mirror/source'
import type { WireAck, WireCommand } from '../../src/mirror/wire'
import { defineProjection } from '../../src/projection/define-projection'
import { createWizard } from '../../src/wizard/create-wizard'
import { checkoutClient, makeWizard, tick } from './fixture'

/** A Standard Schema whose `validate` is asynchronous (resolves on a later microtask). */
function asyncSchema<T>(): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (value) => {
        await Promise.resolve()
        return { value: value as T }
      },
    },
  }
}

const cmd = (
  commandId: string,
  command: WireCommand['command'],
  expectedSeq?: number,
): WireCommand => ({
  commandId,
  instanceId: 'wiz-1',
  ...(expectedSeq === undefined ? {} : { expectedSeq }),
  command,
})

describe('createMirrorSource: the dispatch gate', () => {
  const s = defineFlow({
    name: 'async-events',
    context: boundary.trusted<Record<string, never>>(),
    events: { ping: asyncSchema<{ readonly id: string }>() },
  })
  const pings = s.steps(
    {
      wait: s.wait({ on: { ping: () => {} }, next: 'end' }),
      end: s.final(),
    },
    { start: 'wait' },
  )
  const pingsClient = defineProjection(pings, { expose: {} })

  it('two concurrent sends through an ASYNC event boundary with the same expectedSeq: one passes, the other is STALE', async () => {
    const wizard = createWizard(pings, {
      context: {},
      instanceId: 'wiz-1',
      scheduler: createTestScheduler(),
      ids: createSequentialIds(),
    })
    await wizard.start()
    const source = createMirrorSource(wizard, pingsClient)
    const seq = wizard.getState().seq
    const [a, b] = await Promise.all([
      source.dispatch(cmd('a', { type: 'send', event: 'ping', payload: { id: '1' } }, seq)),
      source.dispatch(cmd('b', { type: 'send', event: 'ping', payload: { id: '2' } }, seq)),
    ])
    expect(a.result).toMatchObject({ ok: true })
    expect(b.result).toMatchObject({ ok: false, code: 'STALE' })
    expect(b.seq).toBe(wizard.getState().seq)
    // Exactly one event was received.
    expect(wizard.log().filter((e) => e.type === 'event.received')).toHaveLength(1)
    wizard.dispose()
  })

  it('commands without expectedSeq are ordered behind a pending send too (the gate is one ordering point)', async () => {
    const wizard = createWizard(pings, { context: {}, instanceId: 'wiz-1' })
    await wizard.start()
    const source = createMirrorSource(wizard, pingsClient)
    const order: string[] = []
    const first = source
      .dispatch(cmd('a', { type: 'send', event: 'ping', payload: { id: '1' } }))
      .then((ack) => order.push(`a:${ack.result.ok}`))
    const second = source
      .dispatch(cmd('b', { type: 'cancel' }))
      .then((ack) => order.push(`b:${ack.result.ok}`))
    await Promise.all([first, second])
    // The send was routed first (the wait completed, the flow is done); the cancel came after → rejected.
    expect(order).toEqual(['a:true', 'b:false'])
    wizard.dispose()
  })

  it('the gate is released once a command is ENQUEUED: a transition waiting on a slow hook does not block other clients', async () => {
    let releaseEnter: () => void = () => {}
    const f = defineFlow({ name: 'slow-enter', context: boundary.trusted<Record<string, never>>() })
    const flow = f.steps(
      {
        a: f.view({ next: 'b' }),
        b: f.view({
          enter: () =>
            new Promise<void>((resolve) => {
              releaseEnter = resolve
            }),
        }),
      },
      { start: 'a' },
    )
    const wizard = createWizard(flow, { context: {}, instanceId: 'wiz-1' })
    await wizard.start()
    const source = createMirrorSource(wizard, defineProjection(flow, { expose: {} }))
    let nextSettled = false
    const pendingNext = source.dispatch(cmd('n', { type: 'next' })).then((ack) => {
      nextSettled = true
      return ack
    })
    await tick()
    expect(nextSettled).toBe(false) // the transition is waiting on `enter`
    // Another client's command goes through while that transition is in flight.
    const cancel = await source.dispatch(cmd('c', { type: 'cancel', reason: 'impatient' }))
    expect(cancel.result).toMatchObject({ ok: true })
    releaseEnter()
    const next = await pendingNext
    expect(next.commandId).toBe('n')
    wizard.dispose()
  })
})

describe('createMirrorSource: hostile input never rejects', () => {
  const dispatchRaw = async (source: ReturnType<typeof createMirrorSource>, input: unknown) =>
    source.dispatch(input as WireCommand)

  it('deep, wide, huge and prototype-flavoured payloads are INVALID_COMMAND values (the decoder has limits)', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const source = createMirrorSource(wizard, checkoutClient)

    let deep: unknown = 1
    for (let i = 0; i < 20_000; i += 1) deep = { a: deep }
    const tooDeep = await source.dispatch(
      cmd('d', { type: 'setInput', step: 'shipping', patch: deep as Record<string, unknown> }),
    )
    expect(tooDeep.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(JSON.stringify(tooDeep.result)).toMatch(/nests deeper than 64/)

    const wide = await source.dispatch(
      cmd('w', {
        type: 'setInput',
        step: 'shipping',
        patch: Array.from({ length: 10_001 }, () => 1),
      }),
    )
    expect(JSON.stringify(wide.result)).toMatch(/more than 10000 values/)

    const huge = await source.dispatch(
      cmd('h', { type: 'setInput', step: 'shipping', patch: { address: 'x'.repeat(70_000) } }),
    )
    expect(JSON.stringify(huge.result)).toMatch(/longer than 65536/)
    const hugeId = await dispatchRaw(source, {
      commandId: 'x'.repeat(70_000),
      instanceId: 'wiz-1',
      command: { type: 'next' },
    })
    expect(hugeId.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })

    // `__proto__` as an OWN key (what JSON.parse yields) is a plain JSON key: accepted, never a
    // prototype write.
    const proto = await source.dispatch(
      cmd('p', {
        type: 'setInput',
        step: 'shipping',
        patch: JSON.parse('{"address":"Main St","__proto__":{"polluted":true}}'),
      }),
    )
    expect(proto.result).toMatchObject({ ok: true })
    expect({} as { polluted?: boolean }).not.toHaveProperty('polluted')
    expect(Object.hasOwn(wizard.getState().steps.shipping.input ?? {}, '__proto__')).toBe(true)
    // …but on the envelope it is an unknown property.
    const envelope = await dispatchRaw(
      source,
      JSON.parse(
        '{"commandId":"e","instanceId":"wiz-1","command":{"type":"next"},"__proto__":{"x":1}}',
      ),
    )
    expect(envelope.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })

    // Inherited property names are not command types / events / steps.
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const ack = await source.dispatch(cmd('t', { type } as never))
      expect(ack.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    }
    const event = await source.dispatch(
      cmd('ev', { type: 'send', event: 'constructor', payload: {} } as never),
    )
    expect(event.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    const step = await source.dispatch(cmd('st', { type: 'go', step: 'constructor' } as never))
    expect(step.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })

    // Non-plain envelopes and commands (a class instance, an object with inherited required
    // fields) are rejected as shapes.
    class Envelope {
      commandId = 'k'
      instanceId = 'wiz-1'
      command = { type: 'next' }
    }
    expect((await dispatchRaw(source, new Envelope())).result).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    const inherited = Object.create({
      commandId: 'i',
      instanceId: 'wiz-1',
      command: { type: 'next' },
    })
    expect((await dispatchRaw(source, inherited)).result).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    const commandInherited = await source.dispatch(cmd('ci', Object.create({ type: 'next' })))
    expect(commandInherited.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })

    // The wizard is untouched by all of it.
    expect(wizard.getState().current).toBe('shipping')
    const acks: WireAck[] = [tooDeep, wide, huge, hugeId, envelope, event, step]
    expect(acks.every((a) => a.result.ok === false)).toBe(true)
    wizard.dispose()
  })
})
