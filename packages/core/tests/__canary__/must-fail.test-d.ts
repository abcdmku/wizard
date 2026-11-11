/**
 * CANARY — this file MUST fail to typecheck.
 *
 * `pnpm test:canary` (scripts/check-type-canary.mjs) runs tsc on this file and
 * asserts that it reports an error. If this file ever typechecks, the type-test
 * harness is broken (that is exactly what happened in v1: type tests that
 * silently verified nothing).
 *
 * It is excluded from the normal test/typecheck configs.
 */

import { z } from 'zod'
import { defineWizard } from '../../src/wizard/define-wizard'

const canary = defineWizard(
  { name: 'type-canary', context: z.object({}), events: { ready: z.string() } },
  ({ step, steps }) =>
    steps({
      work: step({ run: () => 1, next: 'missing-step' }),
    }),
)

canary.create({}).send('undeclared-event', 1)
