/**
 * `createMirrorSource` — the server half: frames on subscribe + per commit, wire command gating
 * (`INVALID_COMMAND`, `STALE`, `DISPOSED`), acks with the post-command seq, projection check.
 */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { createMirrorSource } from '../../src/mirror/source'
import type { Frame, WireCommand } from '../../src/mirror/wire'
import { defineProjection } from '../../src/projection/define-projection'
import { checkoutClient, makeWizard, tick } from './fixture'

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

describe('createMirrorSource', () => {
  it('sends the current frame immediately on subscribe, then one frame per committed batch', async () => {
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    const frames: Frame<unknown>[] = []
    const unsubscribe = source.subscribe((f) => frames.push(f))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ kind: 'snapshot', instanceId: 'wiz-1', epoch: 0, seq: 0 })
    expect(frames[0]?.state).toMatchObject({
      status: 'idle',
      current: null,
      context: { total: 10, express: false },
    })

    await wizard.start()
    expect(frames).toHaveLength(2)
    expect(frames[1]).toMatchObject({ seq: wizard.getState().seq })
    expect(frames[1]?.state).toMatchObject({ current: 'shipping' })

    // A rejected command that changes nothing (invalid input recorded as issues) still commits.
    await wizard.setInput('shipping', { address: 'Main St' })
    const before = frames.length
    expect(before).toBeGreaterThan(2)
    unsubscribe()
    await wizard.setInput('shipping', { express: true })
    expect(frames).toHaveLength(before) // unsubscribed listeners get nothing
    source.dispose()
    wizard.dispose()
  })

  it('shares one frame object between subscribers and only projects exposed fields', async () => {
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    let a: Frame<unknown> | undefined
    let b: Frame<unknown> | undefined
    source.subscribe((f) => {
      a = f
    })
    source.subscribe((f) => {
      b = f
    })
    expect(a).toBe(b)
    await wizard.start()
    expect(a).toBe(b)
    const state = a?.state as Record<string, unknown>
    expect(Object.keys(state.context as object)).toEqual(['total', 'express'])
    expect(JSON.stringify(state)).not.toContain('hunter2')
    expect(JSON.stringify(state)).not.toContain('secret')
    source.dispose()
    wizard.dispose()
  })

  it('dispatch: decodes, gates by instanceId / expectedSeq, dispatches, acks with the post-command seq', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const source = createMirrorSource(wizard, checkoutClient)
    const seq0 = wizard.getState().seq

    const ok = await source.dispatch({
      commandId: 'c1',
      instanceId: 'wiz-1',
      expectedSeq: seq0,
      command: { type: 'setInput', step: 'shipping', patch: { address: 'Main St' } },
    })
    expect(ok.commandId).toBe('c1')
    expect(ok.result).toMatchObject({ ok: true })
    expect(ok.seq).toBe(wizard.getState().seq)
    expect(ok.seq).toBeGreaterThan(seq0)
    expect(wizard.getState().steps.shipping.input).toEqual({ address: 'Main St' })

    const stale = await source.dispatch({
      commandId: 'c2',
      instanceId: 'wiz-1',
      expectedSeq: seq0,
      command: { type: 'next' },
    })
    expect(stale.result).toMatchObject({ ok: false, code: 'STALE' })
    expect(stale.seq).toBe(wizard.getState().seq)
    expect(wizard.getState().current).toBe('shipping') // not applied

    const foreign = await source.dispatch({
      commandId: 'c3',
      instanceId: 'other',
      command: { type: 'next' },
    })
    expect(foreign.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect((foreign.result as { message: string }).message).toMatch(/other/)

    const malformed = await source.dispatch({
      commandId: 'c4',
      instanceId: 'wiz-1',
      command: { type: 'wat' } as never,
    })
    expect(malformed.commandId).toBe('c4')
    expect(malformed.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(malformed.result.ok === false && malformed.result.issues?.length).toBeGreaterThan(0)

    // Ids are checked against the wizard's flow at the door (parseWireCommand(flow, …)).
    const unknownId = await source.dispatch({
      commandId: 'c4b',
      instanceId: 'wiz-1',
      command: { type: 'go', step: 'reserve' },
    })
    expect(unknownId.result).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
      issues: [{ message: "'reserve' is not a view step", path: ['command', 'step'] }],
    })

    // Not even an object: best-effort commandId (empty).
    const garbage = await source.dispatch(null as never)
    expect(garbage.commandId).toBe('')
    expect(garbage.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })

    // The wizard's own data-level rejections come back as results.
    const noHistory = await source.dispatch({
      commandId: 'c5',
      instanceId: 'wiz-1',
      command: { type: 'back' },
    })
    expect(noHistory.result).toMatchObject({ ok: false })

    // Advance without expectedSeq (no optimistic concurrency).
    const nav = await source.dispatch({
      commandId: 'c6',
      instanceId: 'wiz-1',
      command: { type: 'next' },
    })
    expect(nav.result).toMatchObject({ ok: true })
    await tick()
    expect(wizard.getState().status).toBe('done')
    source.dispose()
    wizard.dispose()
  })

  it('a disposed wizard answers DISPOSED as a result, not a rejection', async () => {
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    wizard.dispose()
    const ack = await source.dispatch({
      commandId: 'c',
      instanceId: 'wiz-1',
      command: { type: 'next' },
    })
    expect(ack.result).toMatchObject({ ok: false, code: 'DISPOSED' })
  })

  it('dispose() stops frames and rejects new subscriptions; the wizard keeps running', async () => {
    const wizard = makeWizard()
    const source = createMirrorSource(wizard, checkoutClient)
    let count = 0
    source.subscribe(() => {
      count += 1
    })
    source.dispose()
    source.dispose() // idempotent
    await wizard.start()
    expect(count).toBe(1)
    expect(() => source.subscribe(() => {})).toThrow(WizardError)
    expect(wizard.getState().current).toBe('shipping')
    wizard.dispose()
  })

  it('rejects a projection defined for another flow (DEFINITION_INVALID) at creation', () => {
    const o = defineFlow({ name: 'other', context: boundary.trusted() })
    const other = o.steps({ e: o.final() })
    const otherProjection = defineProjection(other, { expose: {} })
    const wizard = makeWizard()
    expect(() => createMirrorSource(wizard, otherProjection as never)).toThrow(WizardError)
    wizard.dispose()
  })

  it('answers DISPOSED (a value, not a rejection) to commands after dispose()', async () => {
    const wizard = makeWizard()
    await wizard.start()
    const source = createMirrorSource(wizard, checkoutClient)
    source.dispose()
    const ack = await source.dispatch(cmd('c1', { type: 'setInput', step: 'shipping', patch: {} }))
    expect(ack).toEqual({
      commandId: 'c1',
      result: { ok: false, code: 'DISPOSED', message: 'mirror source is disposed' },
      seq: wizard.getState().seq,
    })
    expect(wizard.getState().steps.shipping.input).toBeUndefined() // nothing reached the wizard
    wizard.dispose()
  })
})
