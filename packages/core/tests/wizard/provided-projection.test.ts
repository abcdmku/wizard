import { expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, defineProjection, defineWizard } from '../../src'
import { createRun } from '../../src/wizard/create-wizard'

const context = z.object({ name: z.string() })
const deps = boundary.trusted<{ prefix: string; suffix: string }>()
const authored = () =>
  defineWizard({ name: 'provided-projection', context, deps }, ({ step, steps }) =>
    steps({
      answer: step({ run: ({ context, deps }) => `${deps.prefix}:${context.name}:${deps.suffix}` }),
    }),
  )

it('uses a base projection with chained provided variants while keeping their dependency bindings separate', async () => {
  const wizard = authored()
  const projection = defineProjection(wizard, { expose: { context: ['name'], output: true } })
  const provided = wizard.provide({ prefix: 'a' }).provide({ suffix: 'x' })
  const other = provided.provide({ prefix: 'b' })
  const first = provided.create({ name: 'Ada' })
  const second = other.create({ name: 'Ada' })
  await first.start()
  await second.start()
  expect(first.project(projection)).toMatchObject({ context: { name: 'Ada' }, output: 'a:Ada:x' })
  expect(second.project(projection)).toMatchObject({ context: { name: 'Ada' }, output: 'b:Ada:x' })
  first.dispose()
  second.dispose()
})

it('rejects separately authored definitions with the same name and shape', () => {
  const wizard = authored()
  const projection = defineProjection(wizard, { select: (state) => state.context.name })
  const unrelated = authored().provide({ prefix: 'a', suffix: 'x' }).create({ name: 'secret' })
  expect(() => unrelated.project(projection)).toThrow('different authored definition')
  unrelated.dispose()
})

it('does not grant shared definition identity to an arbitrary object clone', () => {
  const wizard = authored()
  const projection = defineProjection(wizard, { select: (state) => state.context.name })
  const provided = wizard.provide({ prefix: 'a', suffix: 'x' })
  const clone = createRun({ ...provided }, { context: { name: 'secret' } })
  expect(() => clone.project(projection)).toThrow('different authored definition')
  clone.dispose()
})
