/**
 * D6: a hook's `context` is the context when it actually starts (earlier synchronous updates
 * included), and `update(fn)` applies `fn` to the latest committed context, so fan-out branches
 * never lose each other's writes.
 */
import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { flow, runStep } from '../helpers/fixtures'
import { e2e } from '../wizard/e2e/harness'

type Ctx = { readonly ran: readonly string[] }
const ran = (args: HookArgs) => (args.context as Ctx).ran

const fanOut = (branch: (args: HookArgs) => unknown) =>
  flow({
    start: 'a',
    steps: {
      a: runStep({ run: ({ update }) => update({ ran: ['a'] }), next: ['b', 'c'] }),
      b: runStep({ run: branch, next: 'd' }),
      c: runStep({ run: branch, next: 'd' }),
      d: runStep({ run: (args) => ran(args), dependsOn: ['b', 'c'] }),
    },
  })

describe('context updates', () => {
  it('synchronous fan-out branches see each other’s updates', async () => {
    const t = e2e(fanOut((args) => args.update({ ran: [...ran(args), args.step] })))
    await t.run.start()
    expect(t.run.getState()).toMatchObject({ status: 'done', output: ['a', 'b', 'c'] })
  })

  it('update(fn) lands every asynchronous fan-out write', async () => {
    const t = e2e(
      fanOut(async ({ step, update }) => {
        await Promise.resolve()
        update((current) => ({ ran: [...(current as Ctx).ran, step] }))
      }),
    )
    await t.run.start()
    const result = await t.run.awaitResult()
    expect(result.status).toBe('done')
    expect(t.run.getState().context).toEqual({ ran: ['a', 'b', 'c'] })
  })

  it('a throwing update(fn) fails the calling step', async () => {
    const def = flow({
      start: 'a',
      steps: {
        a: runStep({
          run: async ({ update }) => {
            update(() => {
              throw new Error('bad patch')
            })
            await new Promise(() => {})
          },
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.run.getState().status).toBe('halted')
    expect(t.rec('a').error).toMatchObject({ kind: 'hook', message: 'bad patch' })
  })
})
