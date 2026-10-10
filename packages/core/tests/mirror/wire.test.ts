import { describe, expect, it } from 'vitest'
import { parseFrame, parseWireCommand } from '../../src/mirror/wire'
import { checkout } from './fixture'

describe('parseWireCommand', () => {
  it('decodes a valid wire command (expectedSeq optional) and re-encodes the nested command through parseCommand', () => {
    const result = parseWireCommand(checkout, {
      commandId: 'cmd-1',
      instanceId: 'wiz-1',
      expectedSeq: 3,
      command: { type: 'setInput', step: 'shipping', patch: { address: 'x' } },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        commandId: 'cmd-1',
        instanceId: 'wiz-1',
        expectedSeq: 3,
        command: { type: 'setInput', step: 'shipping', patch: { address: 'x' } },
      },
    })
    // `expectedSeq` is optional and absent (not `undefined`) when not sent.
    const bare = parseWireCommand(checkout, {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'next' },
    })
    expect(bare).toEqual({
      ok: true,
      value: { commandId: 'c', instanceId: 'w', command: { type: 'next' } },
    })
    expect(bare.ok && 'expectedSeq' in bare.value).toBe(false)
  })

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 1, 'x', [], true]) {
      const result = parseWireCommand(checkout, bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0]?.message).toMatch(/must be an object/)
    }
  })

  it('rejects unknown properties, empty ids and a bad expectedSeq (all issues reported)', () => {
    const result = parseWireCommand(checkout, {
      commandId: '',
      instanceId: 1,
      expectedSeq: -1,
      command: { type: 'next' },
      extra: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const messages = result.issues.map((i) => i.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        "unknown property 'extra' on wire command",
        "'commandId' must be a non-empty string",
        "'instanceId' must be a non-empty string",
        "'expectedSeq' must be a non-negative integer",
      ]),
    )
    expect(result.issues.find((i) => i.message.includes('extra'))?.path).toEqual(['extra'])
    const fractional = {
      commandId: 'c',
      instanceId: 'w',
      expectedSeq: 1.5,
      command: { type: 'next' },
    }
    expect(parseWireCommand(checkout, fractional).ok).toBe(false)
  })

  it('requires command and decodes it strictly (issues are prefixed with the command path)', () => {
    const missing = parseWireCommand(checkout, { commandId: 'c', instanceId: 'w' })
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok)
      expect(missing.issues[0]).toEqual({ message: "'command' is required", path: ['command'] })

    const bad = parseWireCommand(checkout, {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'go', step: 'shipping', nope: 1 },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.issues[0]?.path).toEqual(['command', 'nope'])
      expect(bad.issues[0]?.message).toMatch(/unknown property 'nope'/)
    }

    const internal = parseWireCommand(checkout, {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'sendRejected', event: 'e', issues: [] },
    })
    expect(internal.ok).toBe(false)
    if (!internal.ok) expect(internal.issues[0]?.path).toEqual(['command', 'type'])
  })

  it('checks the nested command against the flow (unknown ids are issues, prefixed with the command path)', () => {
    const result = parseWireCommand(checkout, {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'go', step: 'reserve' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.issues[0]).toEqual({
        message: "'reserve' is not a view step",
        path: ['command', 'step'],
      })
  })

  it('rejects non-JSON payloads inside the nested command', () => {
    const result = parseWireCommand(checkout, {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'setInput', step: 'shipping', patch: { fn: () => 1 } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.path).toEqual(['command', 'patch'])
  })

  it('accepts plain objects only: class instances and inherited required fields are rejected', () => {
    class Envelope {
      commandId = 'c'
      instanceId = 'w'
      command = { type: 'next' }
    }
    expect(parseWireCommand(checkout, new Envelope()).ok).toBe(false)
    const inherited = Object.create({ commandId: 'c', instanceId: 'w', command: { type: 'next' } })
    expect(parseWireCommand(checkout, inherited).ok).toBe(false)
    // A null-prototype object (JSON-like) is fine.
    const bare = Object.assign(Object.create(null), {
      commandId: 'c',
      instanceId: 'w',
      command: { type: 'next' },
    })
    expect(parseWireCommand(checkout, bare).ok).toBe(true)
  })

  it('caps ids at 64 KiB', () => {
    const result = parseWireCommand(checkout, {
      commandId: 'x'.repeat(65_537),
      instanceId: 'w',
      command: { type: 'next' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/at most 65536 characters/)
  })
})

describe('parseFrame', () => {
  const state = { instanceId: 'wiz-1', epoch: 0, seq: 3, status: 'idle', current: null, steps: {} }
  const good = { kind: 'snapshot', instanceId: 'wiz-1', epoch: 0, seq: 3, state }

  it('accepts a well-formed frame and returns a fresh envelope', () => {
    const result = parseFrame(good)
    expect(result).toEqual({ ok: true, value: good })
    if (result.ok) expect(result.value.state).toBe(state)
  })

  it('rejects non-objects, unknown properties, a wrong kind and bad ids / counters', () => {
    for (const bad of [null, undefined, 1, 'x', [], true]) {
      const result = parseFrame(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0]?.message).toMatch(/must be an object/)
    }
    const result = parseFrame({
      ...good,
      kind: 'delta',
      instanceId: '',
      epoch: -1,
      seq: 1.5,
      extra: 1,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        "unknown property 'extra' on frame",
        "'kind' must be 'snapshot'",
        "'instanceId' must be a non-empty string",
        "'epoch' must be a non-negative integer",
        "'seq' must be a non-negative integer",
      ]),
    )
  })

  it('accepts any JSON state (a select projection may yield a primitive / array / null) but requires it; an object state whose own instanceId / epoch / seq differ from the envelope is rejected', () => {
    expect(parseFrame({ ...good, state: 'x' })).toEqual({
      ok: true,
      value: { ...good, state: 'x' },
    })
    expect(parseFrame({ ...good, state: null }).ok).toBe(true)
    expect(parseFrame({ ...good, state: [1, 2] }).ok).toBe(true)
    expect(parseFrame({ ...good, state: 0 }).ok).toBe(true)
    const { state: _omitted, ...missing } = good
    const noState = parseFrame(missing)
    expect(noState.ok).toBe(false)
    if (!noState.ok) expect(noState.issues[0]?.message).toBe("'state' is required")
    const mismatch = parseFrame({ ...good, state: { ...state, seq: 4 } })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok)
      expect(mismatch.issues[0]).toEqual({
        message: "'state.seq' does not match the envelope",
        path: ['state', 'seq'],
      })
    // A state without those facts (a projection could omit them in a future version) is fine.
    expect(parseFrame({ ...good, state: { status: 'idle' } }).ok).toBe(true)
    // Non-plain frames are rejected.
    class F {
      kind = 'snapshot'
      instanceId = 'wiz-1'
      epoch = 0
      seq = 3
      state = state
    }
    expect(parseFrame(new F()).ok).toBe(false)
  })
})
