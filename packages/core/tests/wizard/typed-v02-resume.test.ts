/**
 * The typed façade, v0.2 surface — `migrate` on resume (sync / async doors, hostile results)
 * and `parseCommand` for `skip` / `invalidate`.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { createWizard, resumeWizard, resumeWizardAsync } from '../../src/wizard/create-wizard'
import { parseCommand } from '../../src/wizard/parse-command'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface NodeLikeProcess {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

const s = defineFlow({
  name: 'v02',
  context: z.object({
    id: z.string(),
    note: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  events: {
    'note.added': z.object({ text: z.string(), orderId: z.string().optional() }),
    'order.cancelled': z.object({ orderId: z.string(), reason: z.string() }),
  },
  on: {
    'note.added': ({ payload, update }) => update({ note: `flow:${payload.text}` }),
    'order.cancelled': ({ payload, update }) => {
      update({ cancelled: true })
      return { cancel: payload.reason }
    },
  },
  correlate: {
    'note.added': (p) => p.orderId,
    'order.cancelled': (p) => p.orderId,
  },
})
const flow = s.steps(
  {
    a: s.view({ input: z.object({ v: z.string() }), next: 'b' }),
    b: s.view({ next: 'c' }),
    c: s.view({ when: ({ context }) => context.note !== 'skip-c', next: 'end' }),
    end: s.final({ output: ({ context }) => `note=${context.note ?? ''}` }),
  },
  { start: 'a' },
)

describe('Wizard v0.2: migrate on resume', () => {
  const v1 = defineFlow({ name: 'approval', version: 1, context: z.object({ amount: z.number() }) })
  const flowV1 = v1.steps({ ask: v1.view({ next: 'end' }), end: v1.final() })
  const v2 = defineFlow({
    name: 'approval',
    version: 2,
    context: z.object({ amount: z.number(), currency: z.string() }),
  })
  const flowV2 = v2.steps({ ask: v2.view({ next: 'end' }), end: v2.final() })

  it('calls migrate(snapshot, from) when the version differs; the result must carry the flow version', async () => {
    const store = createMemoryStore()
    const old = createWizard(flowV1, { context: { amount: 5 }, store, key: 'k' })
    await old.start()
    await old.save()
    old.dispose()
    const saved = await store.get('k')
    const seen: unknown[] = []
    const resumed = resumeWizard(flowV2, saved, {
      migrate: (snapshot, from) => {
        seen.push(from)
        const snap = snapshot as {
          flow: { name: string; version: number }
          state: { flow: { name: string; version: number }; context: object }
        }
        // Both the envelope and the state carry the flow identity.
        return {
          ...snap,
          flow: { ...snap.flow, version: 2 },
          state: {
            ...snap.state,
            flow: { ...snap.state.flow, version: 2 },
            context: { ...snap.state.context, currency: 'EUR' },
          },
        }
      },
    })
    expect(seen).toEqual([{ name: 'approval', version: 1 }])
    expect(resumed.getState().context).toEqual({ amount: 5, currency: 'EUR' })
    expect(resumed.getState().current).toBe('ask')
    expect(resumed.epoch).toBe(1)
    resumed.dispose()
    // Without migrate (or when it keeps the old version) the snapshot is incompatible.
    expect(() => resumeWizard(flowV2, saved, {})).toThrow(/SNAPSHOT_INCOMPATIBLE|version/)
    expect(() => resumeWizard(flowV2, saved, { migrate: (snap) => snap })).toThrow(
      /SNAPSHOT_INCOMPATIBLE|version/,
    )
    // Same version: migrate is not called.
    let called = 0
    const same = resumeWizard(flowV1, saved, {
      migrate: (snap) => {
        called += 1
        return snap
      },
    })
    expect(called).toBe(0)
    same.dispose()
    // Async migration through resumeWizardAsync.
    const asyncResumed = await resumeWizardAsync(flowV2, saved, {
      migrate: async (snapshot) => {
        const snap = snapshot as { flow: object; state: { context: object } }
        return {
          ...snap,
          flow: { name: 'approval', version: 2 },
          state: {
            ...snap.state,
            flow: { name: 'approval', version: 2 },
            context: { ...snap.state.context, currency: 'USD' },
          },
        }
      },
    })
    expect(asyncResumed.getState().context).toEqual({ amount: 5, currency: 'USD' })
    asyncResumed.dispose()
  })

  it('sync door: a migrate returning a REJECTED promise is refused without an unhandled rejection; a hostile `then` accessor is a SNAPSHOT_INCOMPATIBLE reason, not an escaping exception', async () => {
    const store = createMemoryStore()
    const old = createWizard(flowV1, { context: { amount: 5 }, store, key: 'k' })
    await old.start()
    await old.save()
    old.dispose()
    const saved = await store.get('k')
    // Core compiles without node types: reach the process through globalThis for the listener.
    const proc = (globalThis as { process?: NodeLikeProcess }).process
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    proc?.on('unhandledRejection', onUnhandled)
    try {
      const rejected = () =>
        resumeWizard(flowV2, saved, { migrate: () => Promise.reject(new Error('later')) })
      expect(rejected).toThrow(/returned a promise .* \(use resumeWizardAsync\)/)
      await tick()
      await tick()
      expect(unhandled).toEqual([])
    } finally {
      proc?.off('unhandledRejection', onUnhandled)
    }
    const hostile = () =>
      resumeWizard(flowV2, saved, {
        migrate: () => ({
          // biome-ignore lint/suspicious/noThenProperty: intentionally hostile thenable
          get then(): never {
            throw new Error('no then for you')
          },
        }),
      })
    expect(hostile).toThrow(/migrate: threw \(no then for you\)/)
    let code: string | undefined
    try {
      hostile()
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('SNAPSHOT_INCOMPATIBLE')
  })
})

describe('parseCommand v0.2: skip / invalidate', () => {
  it('decodes skip / invalidate with step-id checks and exact shapes', () => {
    expect(parseCommand(flow, { type: 'skip', step: 'a', reason: 'ops' })).toEqual({
      ok: true,
      value: { type: 'skip', step: 'a', reason: 'ops' },
    })
    expect(parseCommand(flow, { type: 'invalidate', step: 'b', cascade: false })).toEqual({
      ok: true,
      value: { type: 'invalidate', step: 'b', cascade: false },
    })
    expect(parseCommand(flow, { type: 'skip', step: 'typo' })).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 'invalidate', step: 'typo' })).toMatchObject({ ok: false })
    expect(parseCommand(flow, { type: 'invalidate', step: 'a', cascade: 'yes' })).toMatchObject({
      ok: false,
    })
    expect(parseCommand(flow, { type: 'skip', step: 'a', nope: 1 })).toMatchObject({ ok: false })
  })
})
