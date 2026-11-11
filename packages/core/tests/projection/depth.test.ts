/** Nested projection depth is measured in child edges, including the root's eighth child. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import type { AnyWizard } from '../../src/authoring/types'
import { defineProjection } from '../../src/projection/define-projection'
import { createRun } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('projection depth', () => {
  it('projects 8 real child levels precisely (the depth budget counts child edges)', async () => {
    let current: AnyWizard = defineWizard(
      {
        name: 'leaf',
        context: boundary.trusted<{
          n: number
        }>(),
      },
      ({ step, view, steps }) =>
        steps({
          v: view({ next: 'end' }),
          end: step({ next: null }),
        }),
    )
    let expose: Record<string, unknown> = { steps: { v: { input: true } }, context: ['n'] }
    for (let level = 1; level <= 8; level += 1) {
      current = defineWizard(
        {
          name: `level${level}`,
          context: boundary.trusted<{
            n: number
          }>(),
        },
        ({ step, child, steps }) =>
          steps({
            c: child(current, {
              context: ({ context }) => ({ n: context.n + 1 }),
              next: 'end',
            }),
            end: step({ next: null }),
          }),
      )
      expose = { steps: { c: { child: expose } }, context: ['n'] }
    }
    const rootFlow = current
    const run = createRun(rootFlow, { context: { n: 0 } })
    await run.start()
    const projection = defineProjection(rootFlow, { expose: expose as never })
    let node = run.project(projection) as Record<string, unknown>
    for (let level = 8; level >= 1; level -= 1) {
      expect(node.context).toEqual({ n: 8 - level })
      const steps = node.steps as Record<string, Record<string, unknown>>
      expect(steps.c?.status).toBe('active')
      node = steps.c?.child as Record<string, unknown>
      expect(node).toBeDefined()
      expect('~depth' in node).toBe(false)
    }
    // The leaf (8 child edges below the root) is projected precisely, not the fallback.
    expect(node.context).toEqual({ n: 8 })
    expect((node.steps as Record<string, Record<string, unknown>>).v?.status).toBe('active')
    run.dispose()
  })
})
