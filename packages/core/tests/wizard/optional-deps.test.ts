import { expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, defineWizard } from '../../src'

it('supplies an empty dependency bag at every public constructor when declared optional services are omitted', async () => {
  const wizard = defineWizard(
    {
      name: 'optional-services',
      context: z.object({}),
      deps: boundary.trusted<{ log?: (message: string) => void }>(),
    },
    ({ step, steps }) =>
      steps({
        check: step({
          run: ({ deps }) => {
            deps.log?.('checked')
            return Object.keys(deps)
          },
        }),
      }),
  )
  expect(wizard.runSync({})).toMatchObject({ status: 'done', output: [] })
  expect(await wizard.run({})).toMatchObject({ status: 'done', output: [] })
  const created = wizard.create({})
  const seed = wizard.create({})
  const resumed = wizard.resume(seed.getSnapshot())
  const createdAsync = await wizard.createAsync({})
  const resumedAsync = await wizard.resumeAsync(seed.getSnapshot())
  for (const run of [created, resumed, createdAsync, resumedAsync]) {
    await run.start()
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: [] })
    run.dispose()
  }
  seed.dispose()
})

it('parses omitted optional object dependencies through synchronous and asynchronous schemas', async () => {
  const sync = defineWizard(
    {
      name: 'schema-services',
      context: z.object({}),
      deps: z.object({ label: z.string().optional() }),
    },
    ({ step, steps }) => steps({ check: step({ run: ({ deps }) => deps.label ?? 'none' }) }),
  )
  expect(sync.runSync({})).toMatchObject({ status: 'done', output: 'none' })
  const async = defineWizard(
    {
      name: 'async-schema-services',
      context: z.object({}),
      deps: z.object({ label: z.string().optional() }).refine(async () => true),
    },
    ({ step, steps }) => steps({ check: step({ run: ({ deps }) => deps.label ?? 'none' }) }),
  )
  expect(await async.run({})).toMatchObject({ status: 'done', output: 'none' })
  const seed = await async.createAsync({})
  const resumed = await async.resumeAsync(seed.getSnapshot())
  await resumed.start()
  expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: 'none' })
  seed.dispose()
  resumed.dispose()
})

it('defaults omitted parent services for optional child bags at creation and restoration', async () => {
  const trusted = defineWizard(
    {
      name: 'optional-child-trusted',
      context: z.object({}),
      deps: boundary.trusted<{ log?: (message: string) => void }>(),
    },
    ({ step, view, steps }) =>
      steps({
        read: step({
          run: ({ deps }) => {
            deps.log?.('child')
            return 'none'
          },
          next: 'ask',
        }),
        ask: view({ input: z.object({}), initial: {}, next: 'done' }),
        done: step({
          run: ({ deps }) => {
            deps.log?.('resumed child')
            return 'none'
          },
        }),
      }),
  )
  const schema = defineWizard(
    {
      name: 'optional-child-schema',
      context: z.object({}),
      deps: z.object({ label: z.string().optional() }),
    },
    ({ step, view, steps }) =>
      steps({
        ask: view({ input: z.object({}), initial: {}, next: 'done' }),
        done: step({ run: ({ deps }) => deps.label ?? 'none' }),
      }),
  )
  const parent = defineWizard(
    { name: 'optional-children', context: z.object({}) },
    ({ flow, step, steps }) => {
      const first = flow(trusted, { context: () => ({}) })
      const second = flow(schema, { context: () => ({}) })
      return steps(
        { first, second, join: step({ needs: { first, second }, run: ({ needs }) => needs }) },
        { start: ['first', 'second'] },
      )
    },
  )
  const original = parent.create({})
  await original.start()
  expect(original.waitingFor()).toEqual([
    { kind: 'view', path: ['first'], step: 'ask' },
    { kind: 'view', path: ['second'], step: 'ask' },
  ])
  const resumed = parent.resume(JSON.parse(JSON.stringify(original.getSnapshot())))
  original.dispose()
  await resumed.whenIdle()
  await resumed.child('first').next()
  await resumed.child('second').next()
  expect(await resumed.awaitResult()).toMatchObject({
    status: 'done',
    output: { first: 'none', second: 'none' },
  })
  resumed.dispose()
})

it('preserves explicit undefined root services, inherited declared undefined and explicit mapper results', async () => {
  const direct = defineWizard(
    { name: 'direct-undefined-services', context: z.object({}), deps: z.undefined() },
    ({ step, steps }) => steps({ check: step({ run: ({ deps }) => deps === undefined }) }),
  )
  expect(direct.runSync({}, { deps: undefined })).toMatchObject({ status: 'done', output: true })
  expect(await direct.run({}, { deps: undefined })).toMatchObject({ status: 'done', output: true })
  let reads = 0
  class InheritedUndefined {
    get deps(): undefined {
      reads++
      return undefined
    }
  }
  expect(direct.runSync({}, new InheritedUndefined())).toMatchObject({
    status: 'done',
    output: true,
  })
  expect(reads).toBe(1)
  const child = defineWizard(
    { name: 'undefined-child-services', context: z.object({}), deps: z.undefined() },
    ({ step, view, steps }) =>
      steps({
        ask: view({ input: z.object({}), initial: {}, next: 'check' }),
        check: step({ run: ({ deps }) => deps === undefined }),
      }),
  )
  const parent = defineWizard(
    { name: 'undefined-parent-services', context: z.object({}), deps: z.undefined() },
    ({ flow, steps }) => steps({ child: flow(child, { context: () => ({}) }) }),
  )
  const original = parent.create({}, { deps: undefined })
  await original.start()
  const resumed = parent.resume(JSON.parse(JSON.stringify(original.getSnapshot())), {
    deps: undefined,
  })
  await resumed.whenIdle()
  await resumed.child('child').next()
  expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: true })
  original.dispose()
  resumed.dispose()
  const mapped = defineWizard(
    { name: 'mapped-undefined-services', context: z.object({}) },
    ({ flow, steps }) =>
      steps({ child: flow(child, { context: () => ({}), deps: () => undefined }) }),
  )
  const mappedRun = mapped.create({})
  await mappedRun.start()
  await mappedRun.child('child').next()
  expect(await mappedRun.awaitResult()).toMatchObject({ status: 'done', output: true })
  mappedRun.dispose()
})

it('retains scalar dependencies and the undefined default when no dependency boundary is declared', async () => {
  const scalarChild = defineWizard(
    { name: 'scalar-child-services', context: z.object({}), deps: z.number() },
    ({ step, steps }) => steps({ check: step({ run: ({ deps }) => deps * 2 }) }),
  )
  const scalarParent = defineWizard(
    { name: 'scalar-parent-services', context: z.object({}), deps: z.number() },
    ({ flow, steps }) => steps({ child: flow(scalarChild, { context: () => ({}) }) }),
  )
  expect(await scalarParent.run({}, { deps: 7 })).toMatchObject({ status: 'done', output: 14 })
  const none = defineWizard({ name: 'no-services', context: z.object({}) }, ({ step, steps }) =>
    steps({ check: step({ run: ({ deps }) => deps === undefined }) }),
  )
  expect(none.runSync({})).toMatchObject({ status: 'done', output: true })
})
