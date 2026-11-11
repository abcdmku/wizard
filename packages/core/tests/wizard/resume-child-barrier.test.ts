import { expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, defineWizard, type Snapshot } from '../../src'

it('includes the full restored child tree in the first resume commit', async () => {
  const leaf = defineWizard({ name: 'leaf-resume', context: z.object({}) }, ({ view, steps }) =>
    steps({
      form: view({ input: z.object({ answer: z.string() }), initial: { answer: 'saved' } }),
    }),
  )
  const childWizard = defineWizard(
    { name: 'child-resume', context: z.object({}) },
    ({ child, steps }) => steps({ nested: child(leaf, { context: () => ({}) }) }),
  )
  const parent = defineWizard(
    { name: 'parent-resume', context: z.object({}) },
    ({ child, steps }) => steps({ child: child(childWizard, { context: () => ({}) }) }),
  )
  const source = parent.create({})
  await source.start()
  const persisted = JSON.parse(JSON.stringify(source.getSnapshot()))
  source.dispose()
  const commits: Snapshot<typeof parent>[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const resumed = parent.resume(persisted, {
    beforeEffects: ({ snapshot, events }) => {
      commits.push(snapshot)
      if (events.some((event) => event.type === 'run.resumed')) return gate
    },
  })
  expect(commits).toHaveLength(1)
  expect(commits[0]?.children.child?.children.nested?.state).toMatchObject({
    current: 'form',
    steps: { form: { input: { answer: 'saved' } } },
  })
  expect(commits[0]?.children.child?.epoch).toBe(1)
  expect(commits[0]?.children.child?.children.nested?.epoch).toBe(1)
  release()
  await resumed.whenIdle()
  expect(resumed.waitingFor()).toEqual([{ kind: 'view', path: ['child', 'nested'], step: 'form' }])
  const crashedAfterFirstCommit = parent.resume(JSON.parse(JSON.stringify(commits[0])))
  await crashedAfterFirstCommit.whenIdle()
  expect(
    crashedAfterFirstCommit.child('child').child('nested').getState().steps.form.input,
  ).toEqual({ answer: 'saved' })
  resumed.dispose()
  crashedAfterFirstCommit.dispose()
})

it('rejects a missing live mapped child snapshot before executing recovery', async () => {
  const childWizard = defineWizard(
    { name: 'mapped-wait', context: z.object({}), events: { done: z.string() } },
    ({ step, steps }) =>
      steps({ wait: step({ waitFor: { done: ({ payload }) => ({ done: payload }) } }) }),
  )
  const parent = defineWizard(
    { name: 'mapped-parent', context: z.object({}) },
    ({ child, steps }) =>
      steps({ map: child(childWizard, { each: () => [1], context: () => ({}) }) }),
  )
  const run = parent.create({})
  await run.start()
  const snapshot = JSON.parse(JSON.stringify(run.getSnapshot()))
  snapshot.children = {}
  run.dispose()
  expect(() => parent.resume(snapshot)).toThrow(
    "missing snapshot for running mapped child 'map' item 0",
  )
})

it('attaches every sibling before a dependency mapper failure can commit', async () => {
  const childWizard = defineWizard(
    {
      name: 'restore-deps-child',
      context: z.object({}),
      deps: boundary.trusted<{ blocked: boolean }>(),
    },
    ({ view, steps }) =>
      steps({ form: view({ input: z.object({ draft: z.string() }), initial: { draft: '' } }) }),
  )
  const parent = defineWizard(
    {
      name: 'restore-deps-parent',
      context: z.object({}),
      deps: boundary.trusted<{ blocked: boolean }>(),
    },
    ({ child, steps }) =>
      steps(
        {
          a: child(childWizard, {
            context: () => ({}),
            deps: ({ deps }) => {
              if (deps.blocked) throw new Error('dependency temporarily unavailable')
              return deps
            },
          }),
          b: child(childWizard, { context: () => ({}) }),
        },
        { start: ['a', 'b'] },
      ),
  )
  const run = parent.create({}, { deps: { blocked: false } })
  await run.start()
  await run.child('b').setInput('form', { draft: 'persisted sibling' })
  const snapshot = JSON.parse(JSON.stringify(run.getSnapshot()))
  run.dispose()
  const commits: Snapshot<typeof parent>[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const resumed = parent.resume(snapshot, {
    deps: { blocked: true },
    beforeEffects: ({ snapshot }) => {
      commits.push(snapshot)
      if (commits.length === 1) return gate
    },
  })
  expect(commits).toHaveLength(1)
  expect(commits[0]?.children.b?.state.steps.form.input).toEqual({ draft: 'persisted sibling' })
  release()
  await resumed.whenIdle()
  expect(resumed.getState().status).toBe('halted')
  expect(resumed.child('b').getState().steps.form.input).toEqual({ draft: 'persisted sibling' })
  resumed.dispose()
})
