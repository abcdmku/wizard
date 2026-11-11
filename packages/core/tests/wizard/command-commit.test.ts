import { expect, it } from 'vitest'
import { z } from 'zod'
import { type Command, type CommandResult, defineWizard } from '../../src'

it('associates the exact dispatch object and final result with an asynchronous navigation commit', async () => {
  let release!: () => void
  const guard = new Promise<boolean>((resolve) => {
    release = () => resolve(true)
  })
  const wizard = defineWizard(
    { name: 'command-association', context: z.object({}) },
    ({ view, step, steps }) =>
      steps({
        form: view({ input: z.object({}), initial: {}, canExit: () => guard, next: 'done' }),
        done: step({ run: () => 42 }),
      }),
  )
  const commits: { command: Command<typeof wizard>; result?: CommandResult }[] = []
  const run = wizard.create(
    {},
    {
      beforeEffects: ({ commands }) => {
        commits.push(...commands)
      },
    },
  )
  await run.start()
  commits.length = 0
  const command: Command<typeof wizard> = { type: 'next' }
  const pending = run.dispatch(command)
  expect(commits).toEqual([{ command }])
  expect(commits[0]?.command).toBe(command)
  await run.setInput('form', {})
  expect(commits.filter((entry) => entry.command === command)).toHaveLength(1)
  release()
  const result = await pending
  const final = commits.filter((entry) => entry.command === command)
  expect(final).toEqual([{ command }, { command, result }])
  expect(result).toMatchObject({ ok: true })
  run.dispose()
})

it('returns CANCELLED when a queued cancel aborts navigation before its guard starts', async () => {
  let calls = 0
  const wizard = defineWizard(
    { name: 'cancelled-navigation', context: z.object({}) },
    ({ view, step, steps }) =>
      steps({
        form: view({
          input: z.object({}),
          initial: {},
          canExit: () => {
            calls++
            return true
          },
          next: 'done',
        }),
        done: step({ run: () => 42 }),
      }),
  )
  const run = wizard.create({})
  await run.start()
  run.observe((event) => {
    if (event.type === 'transition.started') void run.cancel('no longer needed')
  })
  expect(await run.next()).toMatchObject({
    ok: false,
    reason: 'failed',
    code: 'CANCELLED',
    error: { code: 'CANCELLED', message: 'navigation cancelled' },
  })
  expect(calls).toBe(0)
  expect(run.log().filter((event) => event.type === 'step.guardEvaluated')).toEqual([])
  expect(run.getState().status).toBe('cancelled')
  run.dispose()
})
