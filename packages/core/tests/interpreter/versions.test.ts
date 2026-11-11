/**
 * D3: step records are written in place and a published state rebuilds its `steps` on first
 * read, so every state a subscriber received must still show its committed records. A hook's
 * context must likewise keep the value from when its call started.
 */
import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { apply, initialState } from '../../src/machine/index'
import type { WizardState } from '../../src/machine/state'
import { createEnv, flow, needAll, runStep } from '../helpers/fixtures'
import { e2e } from '../wizard/e2e/harness'

describe('published versions', () => {
  it('every state handed to subscribers keeps its own step records', async () => {
    const def = flow({
      start: 'a',
      steps: {
        a: runStep({ run: () => 1, next: ['b', 'c'] }),
        b: runStep({ run: async () => 2, next: 'd' }),
        c: runStep({ run: () => 3, next: 'd' }),
        d: runStep({ run: () => 4, needs: needAll('b', 'c') }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    await t.run.awaitResult()

    const { env } = createEnv(def)
    let replayed: WizardState = initialState(env, { instanceId: 'e2e', context: {}, now: 10_000 })
    const bySeq = new Map<number, WizardState['steps']>()
    for (const event of t.run.log()) {
      replayed = apply(env, replayed, event)
      bySeq.set(event.seq, replayed.steps)
    }
    expect(t.states.length).toBeGreaterThan(3)
    for (const state of t.states) expect(state.steps).toEqual(bySeq.get(state.seq))
  })

  it('a hook reading context after awaiting keeps the snapshot from its call', async () => {
    let release = (): void => {}
    let seen: unknown
    const def = flow({
      start: ['a', 'b'],
      steps: {
        a: runStep({
          run: async (args: HookArgs) => {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            seen = args.context
          },
        }),
        b: runStep({ run: ({ update }) => update({ later: true }) }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.rec('b').status).toBe('done')
    expect(t.run.getState().context).toEqual({ later: true })
    release()
    await t.run.awaitResult()
    expect(seen).toEqual({})
  })
})
