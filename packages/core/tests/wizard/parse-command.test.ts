import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { decodeCommand, parseCommand } from '../../src/wizard/parse-command'

// A flow with every id kind the decoder checks: views (a, v), tasks (t), a declared event (e),
// a flow step (f) whose child has its own view (g) and grandchild flow step (h) with view (v).
const leaf = defineFlow({ name: 'leaf', context: boundary.trusted() })
const leafFlow = leaf.steps({ v: leaf.view({ next: 'end' }), end: leaf.final() })
const mid = defineFlow({ name: 'mid', context: boundary.trusted() })
const midFlow = mid.steps({
  g: mid.view({ next: 'h' }),
  h: mid.flow(leafFlow, { context: () => ({}), next: 'end' }),
  end: mid.final(),
})
const s = defineFlow({
  name: 'root',
  context: boundary.trusted<{ n: number }>(),
  events: { e: z.object({ id: z.number() }) },
})
const flow = s.steps({
  a: s.view({ input: z.object({ x: z.number(), list: z.array(z.unknown()) }), next: 't' }),
  t: s.task(async () => 1, { next: 'f' }),
  f: s.flow(midFlow, { context: () => ({}), next: 'v' }),
  v: s.view({ next: 'x' }),
  x: s.final(),
})

describe('parseCommand(flow, input)', () => {
  it('accepts every wire command shape (ids checked against the flow) and returns a fresh copy', () => {
    const cases: unknown[] = [
      { type: 'start' },
      { type: 'next' },
      { type: 'back' },
      { type: 'runReady' },
      { type: 'reset' },
      { type: 'go', step: 'a' },
      { type: 'go', step: 'a', reason: 'why' },
      { type: 'setInput', step: 'a', patch: { x: 1, list: [1, 'a', null, { y: true }] } },
      { type: 'setInput', step: 'a', patch: null },
      { type: 'resetInput', step: 'a' },
      { type: 'run', step: 't' },
      { type: 'retry', step: 't' },
      { type: 'send', event: 'e', payload: { id: 1 } },
      { type: 'send', event: 'e', payload: 'raw', correlationId: 'c' },
      { type: 'cancel' },
      { type: 'cancel', reason: 'r' },
      { type: 'compensate' },
      { type: 'compensate', from: 'x', reason: 'r' },
      { type: 'child', path: ['f'], command: { type: 'next' } },
      { type: 'child', path: ['f'], command: { type: 'go', step: 'g' } },
      // A multi-segment path reaches the grandchild: `v` is checked against the leaf flow.
      { type: 'child', path: ['f', 'h'], command: { type: 'go', step: 'v' } },
      {
        type: 'child',
        path: ['f'],
        command: { type: 'child', path: ['h'], command: { type: 'go', step: 'v' } },
      },
    ]
    for (const input of cases) {
      const r = parseCommand(flow, input)
      expect(r.ok, JSON.stringify(input)).toBe(true)
      if (r.ok) {
        expect(r.value).toEqual(input)
        expect(r.value).not.toBe(input)
      }
    }
  })

  it('rejects ids the flow does not know: views, tasks, events, compensate.from, child paths', () => {
    expect(parseCommand(flow, { type: 'go', step: 'nope' })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown step 'nope'", path: ['step'] }],
    })
    expect(parseCommand(flow, { type: 'go', step: 't' })).toMatchObject({
      ok: false,
      issues: [{ message: "'t' is not a view step", path: ['step'] }],
    })
    expect(parseCommand(flow, { type: 'setInput', step: 't', patch: {} })).toMatchObject({
      ok: false,
      issues: [{ message: "'t' is not a view step" }],
    })
    expect(parseCommand(flow, { type: 'resetInput', step: 'f' })).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 'retry', step: 'a' })).toMatchObject({
      ok: false,
      issues: [{ message: "'a' is not a task step" }],
    })
    expect(parseCommand(flow, { type: 'run', step: 'ghost' })).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 'send', event: 'zzz', payload: {} })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown event 'zzz'", path: ['event'] }],
    })
    expect(parseCommand(flow, { type: 'compensate', from: 'ghost' })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown step 'ghost'", path: ['from'] }],
    })
    // Child paths: unknown segment, non-flow segment, and the nested command against the child.
    expect(
      parseCommand(flow, { type: 'child', path: ['nope'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, issues: [{ message: "unknown step 'nope'", path: ['path', 0] }] })
    expect(
      parseCommand(flow, { type: 'child', path: ['a'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      issues: [{ message: "'a' is not a flow step", path: ['path', 0] }],
    })
    expect(
      parseCommand(flow, { type: 'child', path: ['f', 'g'], command: { type: 'next' } }),
    ).toMatchObject({
      ok: false,
      issues: [{ message: "'g' is not a flow step", path: ['path', 1] }],
    })
    expect(
      parseCommand(flow, { type: 'child', path: ['f'], command: { type: 'go', step: 'a' } }),
    ).toMatchObject({
      ok: false,
      issues: [{ message: "unknown step 'a'", path: ['command', 'step'] }],
    })
    expect(
      parseCommand(flow, { type: 'child', path: ['f', 'h'], command: { type: 'go', step: 'g' } }),
    ).toMatchObject({ ok: false, issues: [{ path: ['command', 'step'] }] })
  })

  it('rejects unknown properties instead of dropping them (exact allow-list per type)', () => {
    expect(parseCommand(flow, { type: 'go', step: 'a', evil: 1 })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown property 'evil' on 'go'", path: ['evil'] }],
    })
    expect(parseCommand(flow, { type: 'start', step: 'a' })).toMatchObject({
      ok: false,
      issues: [{ path: ['step'] }],
    })
    expect(parseCommand(flow, { type: 'send', event: 'e', payload: 1, extra: true })).toMatchObject(
      { ok: false },
    )
  })

  it('rejects the façade-internal sendRejected command on the wire', () => {
    expect(parseCommand(flow, { type: 'sendRejected', event: 'e', issues: [] })).toMatchObject({
      ok: false,
      issues: [{ message: "'sendRejected' is internal and cannot be dispatched" }],
    })
  })

  it('requires JSON values for patch and payload', () => {
    expect(parseCommand(flow, { type: 'send', event: 'e', payload: undefined })).toMatchObject({
      ok: false,
      issues: [{ path: ['payload'] }],
    })
    expect(
      parseCommand(flow, { type: 'setInput', step: 'a', patch: { fn: () => 1 } }),
    ).toMatchObject({
      ok: false,
      issues: [{ message: "'patch' must be a JSON value (value.fn is a function)" }],
    })
    expect(
      parseCommand(flow, { type: 'setInput', step: 'a', patch: { d: new Date(0) } }),
    ).toMatchObject({ ok: false })
    expect(
      parseCommand(flow, { type: 'setInput', step: 'a', patch: { n: Number.NaN } }),
    ).toMatchObject({ ok: false })
    expect(
      parseCommand(flow, { type: 'setInput', step: 'a', patch: [1, undefined] }),
    ).toMatchObject({ ok: false })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(parseCommand(flow, { type: 'setInput', step: 'a', patch: cyclic })).toMatchObject({
      ok: false,
    })
  })

  it('rejects non-objects, unknown types and missing/invalid fields with paths', () => {
    expect(parseCommand(flow, null)).toEqual({
      ok: false,
      issues: [{ message: 'command must be an object', path: [] }],
    })
    expect(parseCommand(flow, [])).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 42 })).toMatchObject({
      ok: false,
      issues: [{ path: ['type'] }],
    })
    expect(parseCommand(flow, { type: 'jump' })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown command type 'jump'" }],
    })
    expect(parseCommand(flow, { type: 'go' })).toMatchObject({
      ok: false,
      issues: [{ message: "'step' is required", path: ['step'] }],
    })
    expect(parseCommand(flow, { type: 'go', step: '' })).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 'go', step: 'a', reason: 5 })).toMatchObject({
      ok: false,
      issues: [{ path: ['reason'] }],
    })
    expect(parseCommand(flow, { type: 'setInput', step: 'a' })).toMatchObject({
      ok: false,
      issues: [{ path: ['patch'] }],
    })
    expect(parseCommand(flow, { type: 'send', event: 'e' })).toMatchObject({
      ok: false,
      issues: [{ path: ['payload'] }],
    })
    expect(parseCommand(flow, { type: 'cancel', reason: {} })).toMatchObject({
      ok: false,
      issues: [{ path: ['reason'] }],
    })
    expect(parseCommand(flow, { type: 'compensate', from: 1 })).toMatchObject({
      ok: false,
      issues: [{ path: ['from'] }],
    })
  })

  it('validates child commands recursively with paths and caps the effective path depth', () => {
    expect(
      parseCommand(flow, { type: 'child', path: [], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, issues: [{ path: ['path'] }] })
    expect(
      parseCommand(flow, { type: 'child', path: ['f'], command: { type: 'go' } }),
    ).toMatchObject({ ok: false, issues: [{ path: ['command', 'step'] }] })
    // Shape-only decoding (no flow): one wrapper with 9 segments is as deep as 9 nested wrappers.
    const wide = {
      type: 'child',
      path: Array.from({ length: 9 }, (_, i) => `s${i}`),
      command: { type: 'next' },
    }
    expect(decodeCommand(wide)).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('deeper than 8') }],
    })
    let deep: unknown = { type: 'next' }
    for (let i = 0; i < 9; i += 1) deep = { type: 'child', path: ['f'], command: deep }
    expect(decodeCommand(deep)).toMatchObject({ ok: false })
    // Exactly 8 total segments is fine.
    let ok: unknown = { type: 'next' }
    for (let i = 0; i < 4; i += 1) ok = { type: 'child', path: ['a', 'b'], command: ok }
    expect(decodeCommand(ok).ok).toBe(true)
  })

  it('decodeCommand without a flow checks the shape only (what the runtime dispatch does)', () => {
    expect(decodeCommand({ type: 'go', step: 'anything' })).toEqual({
      ok: true,
      value: { type: 'go', step: 'anything' },
    })
    expect(decodeCommand({ type: 'send', event: 'unknown', payload: 1 }).ok).toBe(true)
    expect(decodeCommand({ type: 'go' })).toMatchObject({ ok: false })
  })

  it('never throws on hostile input: depth, node and string limits, inherited names, non-plain objects', () => {
    let deep: unknown = 1
    for (let i = 0; i < 20_000; i += 1) deep = [deep]
    const tooDeep = parseCommand(flow, { type: 'setInput', step: 'a', patch: deep })
    expect(tooDeep).toMatchObject({ ok: false })
    if (!tooDeep.ok) expect(tooDeep.issues[0]?.message).toMatch(/nests deeper than 64 levels/)

    // Exactly at the limit is fine; one more level is not.
    let atLimit: unknown = 1
    for (let i = 0; i < 64; i += 1) atLimit = { a: atLimit }
    expect(parseCommand(flow, { type: 'setInput', step: 'a', patch: atLimit }).ok).toBe(true)
    expect(parseCommand(flow, { type: 'setInput', step: 'a', patch: { a: atLimit } }).ok).toBe(
      false,
    )

    const wide = parseCommand(flow, {
      type: 'send',
      event: 'e',
      payload: { list: Array.from({ length: 10_000 }, (_, i) => i) },
    })
    expect(wide.ok).toBe(false)
    if (!wide.ok) expect(wide.issues[0]?.message).toMatch(/more than 10000 values/)

    const huge = parseCommand(flow, {
      type: 'setInput',
      step: 'a',
      patch: { address: 'x'.repeat(65_537) },
    })
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.issues[0]?.message).toMatch(/longer than 65536/)
    const hugeId = parseCommand(flow, { type: 'go', step: 'x'.repeat(65_537) })
    expect(hugeId.ok).toBe(false)
    if (!hugeId.ok) expect(hugeId.issues[0]?.message).toMatch(/at most 65536 characters/)

    // Names inherited from Object.prototype are not command types, steps or events.
    for (const type of ['constructor', 'toString', '__proto__', 'valueOf']) {
      const result = parseCommand(flow, { type })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0]?.message).toBe(`unknown command type '${type}'`)
    }
    expect(parseCommand(flow, { type: 'go', step: 'constructor' })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown step 'constructor'" }],
    })
    expect(parseCommand(flow, { type: 'send', event: 'constructor', payload: {} })).toMatchObject({
      ok: false,
      issues: [{ message: "unknown event 'constructor'" }],
    })
    expect(
      parseCommand(flow, { type: 'child', path: ['constructor'], command: { type: 'next' } }),
    ).toMatchObject({ ok: false, issues: [{ message: "unknown step 'constructor'" }] })

    // Only own properties count: a required field on the prototype is missing.
    expect(parseCommand(flow, Object.create({ type: 'next' }))).toMatchObject({
      ok: false,
      issues: [{ message: 'command must be an object' }],
    })
    class Cmd {
      type = 'next'
    }
    expect(parseCommand(flow, new Cmd()).ok).toBe(false)
    // An own `__proto__` key (JSON.parse) is an unknown property on the command …
    expect(parseCommand(flow, JSON.parse('{"type":"next","__proto__":{"x":1}}')).ok).toBe(false)
    // … and an ordinary JSON key inside a payload.
    const payload = parseCommand(flow, {
      type: 'setInput',
      step: 'a',
      patch: JSON.parse('{"__proto__":{"x":1}}'),
    })
    expect(payload.ok).toBe(true)
    expect({} as { x?: number }).not.toHaveProperty('x')

    // Shared references are not cycles: the same object twice is fine, a real cycle is not.
    const shared = { a: 1 }
    expect(
      parseCommand(flow, { type: 'setInput', step: 'a', patch: { x: shared, y: shared } }).ok,
    ).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const cycle = parseCommand(flow, { type: 'setInput', step: 'a', patch: cyclic })
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.issues[0]?.message).toMatch(/is circular/)
  })
})
