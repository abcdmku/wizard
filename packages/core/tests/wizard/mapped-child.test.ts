import { expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard, parseCommand, renameSteps } from '../../src'

it('addresses mapped child event waits by stable key and wire index across resume', async () => {
  const childWizard = defineWizard(
    { name: 'item-wait', context: z.object({ id: z.string() }), events: { approved: z.number() } },
    ({ step, steps }) =>
      steps({ approval: step({ waitFor: { approved: ({ payload }) => ({ done: payload }) } }) }),
  )
  const wizard = defineWizard(
    { name: 'mapped-events', context: z.object({ ids: z.array(z.string()) }) },
    ({ child, steps }) =>
      steps({
        items: child(childWizard, {
          each: ({ context }) => context.ids,
          key: (item) => item,
          context: ({ item }) => ({ id: item }),
        }),
      }),
  )
  const run = wizard.create({ ids: ['a', 'b'] })
  await run.start()
  expect(run.child('items', 1)).toBe(run.child('items', 'b'))
  await run.child('items', 'b').send('approved', 20)
  const snapshot = JSON.parse(JSON.stringify(run.getSnapshot()))
  run.dispose()
  const migrated = defineWizard(
    { name: 'mapped-events', version: 2, context: z.object({ ids: z.array(z.string()) }) },
    ({ child, steps }) =>
      steps({
        batch: child(childWizard, {
          each: ({ context }) => context.ids,
          key: (item) => item,
          context: ({ item }) => ({ id: item }),
        }),
      }),
  )
  const resumed = migrated.resume(snapshot, {
    migrate: (snapshot) => renameSteps(snapshot, { items: 'batch' }),
  })
  await resumed.whenIdle()
  expect(resumed.waitingFor()).toEqual([
    { kind: 'event', path: ['batch', '0'], step: 'approval', events: ['approved'] },
  ])
  const parsed = parseCommand(migrated, {
    type: 'child',
    path: ['batch', '0'],
    command: { type: 'send', event: 'approved', payload: 10 },
  })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('expected a typed mapped-child command')
  expect(await resumed.dispatch(parsed.value)).toMatchObject({ ok: true })
  expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: [10, 20] })
  expect(
    parseCommand(migrated, {
      type: 'child',
      path: ['batch', 'b'],
      command: { type: 'send', event: 'approved', payload: 30 },
    }).ok,
  ).toBe(true)
  resumed.dispose()
})

it('counts mapped selectors separately from the eight-level child nesting limit', async () => {
  const leaf = defineWizard(
    { name: 'depth-leaf', context: z.object({}), events: { done: z.number() } },
    ({ step, steps }) =>
      steps({ wait: step({ waitFor: { done: ({ payload }) => ({ done: payload }) } }) }),
  )
  const a = defineWizard({ name: 'depth-a', context: z.object({}) }, ({ child, steps }) =>
    steps({ a: child(leaf, { each: () => [1], context: () => ({}) }) }),
  )
  const b = defineWizard({ name: 'depth-b', context: z.object({}) }, ({ child, steps }) =>
    steps({ b: child(a, { each: () => [1], context: () => ({}) }) }),
  )
  const c = defineWizard({ name: 'depth-c', context: z.object({}) }, ({ child, steps }) =>
    steps({ c: child(b, { each: () => [1], context: () => ({}) }) }),
  )
  const d = defineWizard({ name: 'depth-d', context: z.object({}) }, ({ child, steps }) =>
    steps({ d: child(c, { each: () => [1], context: () => ({}) }) }),
  )
  const e = defineWizard({ name: 'depth-e', context: z.object({}) }, ({ child, steps }) =>
    steps({ e: child(d, { each: () => [1], context: () => ({}) }) }),
  )
  const run = e.create({})
  await run.start()
  const parsed = parseCommand(e, {
    type: 'child',
    path: ['e', '0', 'd', '0', 'c', '0', 'b', '0', 'a', '0'],
    command: { type: 'send', event: 'done', payload: 42 },
  })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('expected five mapped child levels')
  expect(await run.dispatch(parsed.value)).toMatchObject({ ok: true })
  expect(await run.awaitResult()).toMatchObject({ status: 'done', output: [[[[[42]]]]] })
  run.dispose()
})
