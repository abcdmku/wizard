import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineWizard, type Run } from '../../src'

const wizard = defineWizard(
  { name: 'when-idle-types', context: z.object({ id: z.string() }) },
  ({ step, steps }) => steps({ done: step({}) }),
)

declare const run: Run<typeof wizard>

describe('Run.whenIdle types', () => {
  it('returns only settlement, not a state or command result', () => {
    expectTypeOf(run.whenIdle()).toEqualTypeOf<Promise<void>>()
  })
})
