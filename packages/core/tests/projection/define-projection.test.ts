/**
 * `defineProjection` — the projection record (flow object + spec / select mapper) and its definition problems.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { defineProjection } from '../../src/projection/define-projection'
import { createWizard } from '../../src/wizard/create-wizard'

const c = defineFlow({
  name: 'child',
  context: z.object({ n: z.number(), childSecret: z.string() }),
})
const child = c.steps({
  work: c.task(async () => ({ r: 1 }), { next: 'end' }),
  end: c.final({ output: () => 'child-out' }),
})

const s = defineFlow({
  name: 'root',
  context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
})
const flow = s.steps(
  {
    form: s.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
    reserve: s.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
    sub: s.flow(child, { context: () => ({ n: 1, childSecret: 's' }), next: 'done' }),
    done: s.final({ output: () => ({ receipt: 1 }) }),
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
    expect(defineProjection(child, { expose: {} }).flow).toBe(child)
    const select = (s: { seq: number }) => s.seq
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

  it('wizard.project() rejects a projection of a same-name, same-shape flow (identity, not name)', async () => {
    const twinBuilder = defineFlow({
      name: 'root',
      context: z.object({ cartId: z.string(), total: z.number(), secret: z.string() }),
    })
    const twin = twinBuilder.steps(
      {
        form: twinBuilder.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
        reserve: twinBuilder.task(async () => ({ reservationId: 'r' }), { next: 'sub' }),
        sub: twinBuilder.flow(child, { context: () => ({ n: 1, childSecret: 's' }), next: 'done' }),
        done: twinBuilder.final({ output: () => ({ receipt: 1 }) }),
      },
      { start: 'form' },
    )
    const twinProjection = defineProjection(twin, { expose: { context: ['total'] } })
    const wizard = createWizard(flow, { context: { cartId: 'c', total: 1, secret: 's' } })
    // Type-compatible (structural), rejected at runtime (identity).
    expect(() => wizard.project(twinProjection)).toThrow(WizardError)
    try {
      wizard.project(twinProjection)
    } catch (error) {
      expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      expect((error as WizardError).message).toContain('different flow object')
    }
    expect(
      wizard.project(defineProjection(flow, { expose: { context: ['total'] } })).context,
    ).toEqual({ total: 1 })
    wizard.dispose()
  })
})
