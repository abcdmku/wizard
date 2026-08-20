/**
 * `defineProjection` — the projection record (flow object + spec / select mapper) and its definition problems.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { defineProjection } from '../../src/projection/define-projection'
import { createRun } from '../../src/wizard/create-wizard'

const child = defineFlow({
  name: 'child',
  context: z.object({ n: z.number(), childSecret: z.string() }),
})
const childFlow = child.steps({
  work: child.task(async () => ({ r: 1 }), { next: 'end' }),
  end: child.final({ output: () => 'child-out' }),
})

const root = defineFlow({
  name: 'root',
  context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
})
const flow = root.steps(
  {
    form: root.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
    reserve: root.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
    sub: root.flow(childFlow, { context: () => ({ n: 1, childSecret: 's' }), next: 'done' }),
    done: root.final({ output: () => ({ receipt: 1 }) }),
  },
  { start: 'form' },
)
describe('defineProjection', () => {
  it('records the flow OBJECT and the spec; ~types is undefined; select projections carry the mapper', () => {
    const projection = defineProjection(flow, { expose: { context: ['total'] } })
    expect(projection).toEqual({
      '~types': undefined,
      flow,
      expose: { context: ['total'] },
      select: undefined,
    })
    expect(projection.flow).toBe(flow)
    expect(defineProjection(childFlow, { expose: {} }).flow).toBe(childFlow)
    const select = (state: { seq: number }) => state.seq
    expect(defineProjection(flow, { select })).toEqual({
      '~types': undefined,
      flow,
      expose: undefined,
      select,
    })
  })
  it('exactly one of expose / select (JS callers): DEFINITION_INVALID otherwise', () => {
    const codeOf = (fn: () => unknown): string | undefined => {
      try {
        fn()
      } catch (error) {
        return error instanceof WizardError ? error.code : undefined
      }
      return undefined
    }
    expect(codeOf(() => defineProjection(flow, {} as never))).toBe('DEFINITION_INVALID')
    expect(codeOf(() => defineProjection(flow, { expose: {}, select: () => 1 } as never))).toBe(
      'DEFINITION_INVALID',
    )
    expect(codeOf(() => defineProjection(flow, { select: 5 } as never))).toBe('DEFINITION_INVALID')
    expect(codeOf(() => defineProjection(flow, { expose: 'all' } as never))).toBe(
      'DEFINITION_INVALID',
    )
  })

  it('run.project() rejects a projection of a same-name, same-shape flow (identity, not name)', async () => {
    const twinBuilder = defineFlow({
      name: 'root',
      context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
    })
    const twin = twinBuilder.steps(
      {
        form: twinBuilder.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
        reserve: twinBuilder.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
        sub: twinBuilder.flow(childFlow, {
          context: () => ({ n: 1, childSecret: 's' }),
          next: 'done',
        }),
        done: twinBuilder.final({ output: () => ({ receipt: 1 }) }),
      },
      { start: 'form' },
    )
    const twinProjection = defineProjection(twin, { expose: { context: ['total'] } })
    const run = createRun(flow, { context: { cartId: 'c', total: 1, secret: 's' } })
    // Type-compatible (structural), rejected at runtime (identity).
    expect(() => run.project(twinProjection)).toThrow(WizardError)
    try {
      run.project(twinProjection)
    } catch (error) {
      expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      expect((error as WizardError).message).toContain('different flow object')
    }
    expect(run.project(defineProjection(flow, { expose: { context: ['total'] } })).context).toEqual(
      { total: 1 },
    )
    run.dispose()
  })
})
