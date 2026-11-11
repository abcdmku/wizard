/**
 * `createMirrorSource` — the server half: frames on subscribe + per commit, wire command gating
 * (`INVALID_COMMAND`, `STALE`, `DISPOSED`), acks with the post-command seq, projection check.
 */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { WizardError } from '../../src/errors'
import { createMirrorSource } from '../../src/mirror/source'
import type { Frame, WireCommand } from '../../src/mirror/wire'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'
import { checkoutClient, makeRun, tick } from './fixture'

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
    const run = makeRun()
    const source = createMirrorSource(run, checkoutClient)
    const frames: Frame<unknown>[] = []
    const unsubscribe = source.subscribe((f) => frames.push(f))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: 'snapshot',
      instanceId: 'wiz-1',
      epoch: 0,
      seq: 0,
      state: { status: 'idle', current: null, context: { total: 10, express: false } },
    })
    await run.start()
    expect(frames).toHaveLength(2)
    expect(frames[1]).toMatchObject({ seq: run.getState().seq, state: { current: 'shipping' } })
    // A rejected command that changes nothing (invalid input recorded as issues) still commits.
    await run.setInput('shipping', { address: 'Main St' })
    const before = frames.length
    expect(before).toBeGreaterThan(2)
    unsubscribe()
    await run.setInput('shipping', { express: true })
    expect(frames).toHaveLength(before) // unsubscribed listeners get nothing
    source.dispose()
    run.dispose()
  })
  it('shares one frame object between subscribers and only projects exposed fields', async () => {
    const run = makeRun()
    const source = createMirrorSource(run, checkoutClient)
    let a: Frame<unknown> | undefined
    let b: Frame<unknown> | undefined
    source.subscribe((f) => {
      a = f
    })
    source.subscribe((f) => {
      b = f
    })
    expect(a).toBe(b)
    await run.start()
    expect(a).toBe(b)
    expect(a).toBe(source.getFrame())
    const state = source.getFrame().state as Record<string, unknown>
    expect(Object.keys(state.context as object)).toEqual(['total', 'express'])
    expect(JSON.stringify(state)).not.toContain('hunter2')
    expect(JSON.stringify(state)).not.toContain('secret')
    source.dispose()
    run.dispose()
  })
  it('dispatch: decodes, gates by instanceId / expectedSeq, dispatches, acks with the post-command seq', async () => {
    const run = makeRun()
    await run.start()
    const source = createMirrorSource(run, checkoutClient)
    const seq0 = run.getState().seq
    const ok = await source.dispatch({
      commandId: 'c1',
      instanceId: 'wiz-1',
      expectedSeq: seq0,
      command: { type: 'setInput', step: 'shipping', patch: { address: 'Main St' } },
    })
    expect(ok.commandId).toBe('c1')
    expect(ok.result).toMatchObject({ ok: true })
    expect(ok.seq).toBe(run.getState().seq)
    expect(ok.seq).toBeGreaterThan(seq0)
    expect(run.getState().steps.shipping.input).toEqual({ address: 'Main St' })
    const stale = await source.dispatch({
      commandId: 'c2',
      instanceId: 'wiz-1',
      expectedSeq: seq0,
      command: { type: 'next' },
    })
    expect(stale.result).toMatchObject({ ok: false, code: 'STALE' })
    expect(stale.seq).toBe(run.getState().seq)
    expect(run.getState().current).toBe('shipping') // not applied
    const foreign = await source.dispatch({
      commandId: 'c3',
      instanceId: 'other',
      command: { type: 'next' },
    })
    expect(foreign.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(
      (
        foreign.result as {
          message: string
        }
      ).message,
    ).toMatch(/other/)
    const malformed = await source.dispatch({
      commandId: 'c4',
      instanceId: 'wiz-1',
      command: { type: 'wat' } as never,
    })
    expect(malformed.commandId).toBe('c4')
    expect(malformed.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(malformed.result.ok === false && malformed.result.issues?.length).toBeGreaterThan(0)
    // Ids are checked against the run's flow at the door (parseWireCommand(flow, …)).
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
    // The run's own data-level rejections come back as results.
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
    expect(run.getState().status).toBe('done')
    source.dispose()
    run.dispose()
  })
  it('a disposed run answers DISPOSED as a result, not a rejection', async () => {
    const run = makeRun()
    const source = createMirrorSource(run, checkoutClient)
    run.dispose()
    const ack = await source.dispatch({
      commandId: 'c',
      instanceId: 'wiz-1',
      command: { type: 'next' },
    })
    expect(ack.result).toMatchObject({ ok: false, code: 'DISPOSED' })
  })
  it('dispose() stops frames and rejects new subscriptions; the run keeps running', async () => {
    const run = makeRun()
    const source = createMirrorSource(run, checkoutClient)
    let count = 0
    source.subscribe(() => {
      count += 1
    })
    source.dispose()
    source.dispose() // idempotent
    await run.start()
    expect(count).toBe(1)
    let closed = 0
    source.subscribe(
      () => {
        count += 1
      },
      () => {
        closed += 1
      },
    )
    expect({ count, closed }).toEqual({ count: 1, closed: 1 }) // no frame, closed at once
    expect(run.getState().current).toBe('shipping')
    run.dispose()
  })
  it('rejects a projection defined for another flow (DEFINITION_INVALID) at creation', () => {
    const otherFlow = defineWizard(
      { name: 'other', context: boundary.trusted() },
      ({ step, steps }) => steps({ e: step({ next: null }) }),
    )
    const otherProjection = defineProjection(otherFlow, { expose: {} })
    const run = makeRun()
    expect(() => createMirrorSource(run, otherProjection as never)).toThrow(WizardError)
    run.dispose()
  })
  it('answers DISPOSED (a value, not a rejection) to commands after dispose()', async () => {
    const run = makeRun()
    await run.start()
    const source = createMirrorSource(run, checkoutClient)
    source.dispose()
    const ack = await source.dispatch(cmd('c1', { type: 'setInput', step: 'shipping', patch: {} }))
    expect(ack).toEqual({
      commandId: 'c1',
      result: { ok: false, code: 'DISPOSED', message: 'mirror source is disposed' },
      seq: run.getState().seq,
    })
    expect(run.getState().steps.shipping.input).toBeUndefined() // nothing reached the run
    run.dispose()
  })
})
