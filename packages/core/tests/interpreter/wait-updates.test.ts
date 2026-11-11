import { describe, expect, it } from 'vitest'
import type { Hook } from '../../src/authoring/compiled'
import { eventStep, flow, runStep, trusted } from '../helpers/fixtures'
import { e2e, tick } from '../wizard/e2e/harness'

interface Context {
  readonly phase: string
  readonly count: number
}

const definition = (handler: Hook) =>
  flow({
    start: 'waiting',
    events: { accepted: trusted() },
    steps: {
      waiting: eventStep({ on: { accepted: handler }, next: 'finish' }),
      finish: runStep({ run: ({ context }) => context }),
    },
  })

describe('wait handler updates', () => {
  it('commits synchronous updates and wait completion in one host barrier', async () => {
    const checkpoints: { readonly context: unknown; readonly waiting: string }[] = []
    const t = e2e(
      definition(({ update }) => {
        update({ phase: 'accepted' })
        update((current) => ({ count: (current as Context).count + 1 }))
        return { done: 'accepted' }
      }),
      {
        context: { phase: 'waiting', count: 0 },
        beforeEffects: ({ snapshot }) => {
          checkpoints.push({
            context: snapshot.state.context,
            waiting: snapshot.state.steps.waiting!.status,
          })
        },
      },
    )
    await t.run.start()
    checkpoints.length = 0
    await t.run.send('accepted', null)
    expect(checkpoints).toEqual([
      { context: { phase: 'waiting', count: 0 }, waiting: 'active' },
      { context: { phase: 'accepted', count: 1 }, waiting: 'done' },
      { context: { phase: 'accepted', count: 1 }, waiting: 'done' },
      { context: { phase: 'accepted', count: 1 }, waiting: 'done' },
    ])
    expect(t.run.getState()).toMatchObject({
      status: 'done',
      output: { phase: 'accepted', count: 1 },
    })
    expect(t.of('context.changed')).toHaveLength(2)
  })

  it('commits an update with a synchronous handler failure', async () => {
    const checkpoints: { readonly count: number; readonly waiting: string }[] = []
    const t = e2e(
      definition(({ update }) => {
        update({ count: 1 })
        throw new Error('handler failed')
      }),
      {
        context: { phase: 'waiting', count: 0 },
        beforeEffects: ({ snapshot }) => {
          checkpoints.push({
            count: (snapshot.state.context as Context).count,
            waiting: snapshot.state.steps.waiting!.status,
          })
        },
      },
    )
    await t.run.start()
    checkpoints.length = 0
    await t.run.send('accepted', null)
    expect(checkpoints).toEqual([
      { count: 0, waiting: 'active' },
      { count: 1, waiting: 'failed' },
    ])
    expect(t.run.getState().status).toBe('halted')
    expect(t.rec('waiting').error).toMatchObject({ kind: 'hook', message: 'handler failed' })
  })

  it('flushes updates in order when a handler returns a promise and keeps later updates live', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = e2e(
      definition(async ({ update }) => {
        update({ phase: 'working' })
        update((current) => ({ count: (current as Context).count + 1 }))
        await gate
        update((current) => ({ count: (current as Context).count + 1 }))
        return { done: 'accepted' }
      }),
      { context: { phase: 'waiting', count: 0 } },
    )
    await t.run.start()
    await t.run.send('accepted', null)
    expect(t.rec('waiting').status).toBe('active')
    expect(t.run.getState().context).toEqual({ phase: 'working', count: 1 })
    release()
    await tick()
    expect(t.run.getState()).toMatchObject({
      status: 'done',
      output: { phase: 'working', count: 2 },
    })
  })
})
