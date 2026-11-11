import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('step object references', () => {
  it.each(['static', 'dynamic'] as const)(
    'completes a %s router without running it as a task',
    async (kind) => {
      const wizard = defineWizard(
        { name: `${kind}-router`, context: z.object({}) },
        ({ step, steps }) => {
          const route =
            kind === 'static'
              ? step({ next: 'work' })
              : step({ next: () => 'work', targets: ['work'] })
          return steps({ route, work: step({ run: () => 'worked' }) })
        },
      )
      const run = wizard.create({})
      const started: string[] = []
      run.observe((event) => {
        if (event.type === 'step.runStarted') started.push(event.step)
      })
      try {
        await run.start()
        expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'worked' })
        expect(started).toEqual(['work'])
      } finally {
        run.dispose()
      }
    },
  )

  it.each(['static', 'dynamic'] as const)(
    'enters a manual %s router through startReady',
    async (kind) => {
      const wizard = defineWizard(
        { name: `manual-${kind}-router`, context: z.object({}), autoRun: 'manual' },
        ({ step, steps }) => {
          const route =
            kind === 'static'
              ? step({ next: 'work' })
              : step({ next: () => 'work', targets: ['work'] })
          return steps({ route, work: step({ run: () => 'worked' }) })
        },
      )
      const run = wizard.create({})
      const started: string[] = []
      run.observe((event) => {
        if (event.type === 'step.runStarted') started.push(event.step)
      })
      try {
        await run.start()
        expect(run.explain('route').phase).toBe('ready')
        await run.startReady()
        expect(run.getState().steps.route.status).toBe('done')
        expect(run.explain('work').phase).toBe('ready')
        expect(started).toEqual([])
        await run.startStep('work')
        expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'worked' })
        expect(started).toEqual(['work'])
      } finally {
        run.dispose()
      }
    },
  )

  it('finishes a terminal routing node with undefined output under manual scheduling', async () => {
    const wizard = defineWizard(
      { name: 'manual-terminal-router', context: z.object({}), autoRun: 'manual' },
      ({ step, steps }) => steps({ end: step({}) }),
    )
    const run = wizard.create({})
    try {
      await run.start()
      await run.startReady()
      expect(run.getState().status).toBe('done')
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: undefined })
    } finally {
      run.dispose()
    }
  })

  it.each([true, false])('routes by step identity with declared targets: %s', async (approved) => {
    const wizard = defineWizard(
      { name: 'branch', context: z.object({ approved: z.boolean() }) },
      ({ step, steps }) => {
        const accept = step({ run: () => 'accepted' })
        const reject = step({ run: () => 'rejected' })
        const choose = step({
          next: async ({ context }) => (context.approved ? accept : reject),
          targets: [accept, reject],
        })
        return steps({ choose, accept, reject })
      },
    )
    expect(await wizard.run({ approved })).toMatchObject({
      status: 'done',
      output: approved ? 'accepted' : 'rejected',
    })
  })

  it('keeps parallel branches alive until all finish', async () => {
    let release: ((value: number) => void) | undefined
    const wizard = defineWizard({ name: 'parallel', context: z.object({}) }, ({ step, steps }) => {
      const fast = step({ run: () => 1 })
      const slow = step({
        run: () =>
          new Promise<number>((resolve) => {
            release = resolve
          }),
      })
      return steps({ start: step({ next: [fast, slow] }), fast, slow })
    })
    const run = wizard.create({})
    try {
      await run.start()
      expect(run.result()).toBeUndefined()
      expect(release).toBeTypeOf('function')
      if (release === undefined) throw new Error('slow step did not start')
      release(2)
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 2 })
    } finally {
      run.dispose()
    }
  })

  it('resumes a separate event wait and starts the child once', async () => {
    let calls = 0
    const childWizard = defineWizard({ name: 'child', context: z.object({}) }, ({ step, steps }) =>
      steps({ work: step({ run: () => ++calls }) }),
    )
    const parent = defineWizard(
      { name: 'parent', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, child, steps }) =>
        steps({
          ready: step({ waitFor: { ready: () => ({ done: true }) }, next: 'child' }),
          child: child(childWizard, { context: () => ({}) }),
        }),
    )
    const run = parent.create({})
    await run.start()
    expect(calls).toBe(0)
    const saved = JSON.parse(JSON.stringify(run.getSnapshot()))
    run.dispose()
    const resumed = parent.resume(saved)
    try {
      await resumed.send('ready', true)
      expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: 1 })
      expect(calls).toBe(1)
    } finally {
      resumed.dispose()
    }
  })

  it('resumes a view reached after an event wait without reopening the wait', async () => {
    const wizard = defineWizard(
      { name: 'resume-view', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, view, steps }) =>
        steps({
          ready: step({ waitFor: { ready: () => ({ done: true }) }, next: 'form' }),
          form: view({ input: z.string() }),
        }),
    )
    const run = wizard.create({})
    await run.start()
    await run.send('ready', true)
    const saved = JSON.parse(JSON.stringify(run.getSnapshot()))
    run.dispose()
    const resumed = wizard.resume(saved)
    try {
      await resumed.setInput('form', 'Ada')
      await resumed.next()
      expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: 'Ada' })
    } finally {
      resumed.dispose()
    }
  })

  it('runs terminal exit hooks before publishing completion', async () => {
    const wizard = defineWizard(
      { name: 'exit', context: z.object({ count: z.number() }) },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => 7,
            exit: async ({ update }) => {
              update({ count: 7 })
            },
          }),
        }),
    )
    const run = wizard.create({ count: 0 })
    try {
      await run.start()
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 7 })
      expect(run.getState().context.count).toBe(7)
    } finally {
      run.dispose()
    }
  })

  it('selects final context after async exits and passes the selected output to a parent', async () => {
    const childWizard = defineWizard(
      {
        name: 'selected-child',
        context: z.object({ count: z.number() }),
        output: ({ context }) => ({ total: context.count }),
      },
      ({ step, steps }) =>
        steps({
          work: step({
            run: () => 'intermediate',
            exit: async ({ update }) => {
              update({ count: 42 })
            },
          }),
        }),
    )
    const parent = defineWizard(
      { name: 'selected-parent', context: z.object({}) },
      ({ child, steps }) => steps({ child: child(childWizard, { context: () => ({ count: 0 }) }) }),
    )
    expect(await parent.run({})).toMatchObject({ status: 'done', output: { total: 42 } })
  })

  it('returns output selector failures as terminal failures', async () => {
    const wizard = defineWizard(
      {
        name: 'bad-output',
        context: z.object({}),
        output: () => {
          throw new Error('bad result')
        },
      },
      ({ step, steps }) => steps({ work: step({ run: () => 1 }) }),
    )
    expect(await wizard.run({})).toMatchObject({ status: 'failed' })
  })
})
