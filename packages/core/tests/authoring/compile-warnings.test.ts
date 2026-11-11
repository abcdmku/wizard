import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { analyze, compile, type ManifestWarning } from '../../src/authoring/compile'
import type { AnyWizardDefinition } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'
import { defineWizard } from '../../src/wizard/define-wizard'
import { rawFlow, rawStep } from './helpers'

function warningsOf(flow: AnyWizardDefinition): readonly ManifestWarning[] {
  return analyze(flow).warnings
}

describe('graph warnings', () => {
  it('reports an unreachable step and a step whose only producer is unreachable', () => {
    const wizard = defineWizard(
      { name: 'warnings', context: z.object({}) },
      ({ step, view, steps }) => {
        const a = view({ input: z.string(), next: 'b' })
        const orphan = view({ input: z.string(), next: 'b' })
        return steps({
          a,
          b: step({ run: () => true }),
          orphan,
          fed: step({ run: () => 1, needs: { orphan } }),
          pulled: step({ run: () => 2, needs: { a } }),
        })
      },
    )
    expect(warningsOf(wizard).filter((warning) => warning.code === 'UNREACHABLE')).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'orphan' is not reachable from start",
        step: 'orphan',
        path: [],
      },
      {
        code: 'UNREACHABLE',
        message: "step 'fed' is not reachable from start",
        step: 'fed',
        path: [],
      },
    ])
  })

  it('counts declared routing targets, fallbacks, timeouts and pull needs as reachable edges', () => {
    const wizard = defineWizard(
      { name: 'reachable', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, steps }) => {
        const a = step({ run: () => 1, fallback: 'recover' })
        const b = step({
          waitFor: { ready: () => ({ done: true }) },
          timeout: { after: '1m', next: 'late' },
        })
        return steps({
          route: step({ next: () => [a, b], targets: [a, b] }),
          a,
          b,
          join: step({ needs: { a, b }, run: () => 'joined' }),
          recover: step({ run: () => 'recovered' }),
          late: step({ run: () => 'late' }),
          orphan: step({ run: () => 'orphan' }),
        })
      },
    )
    expect(
      warningsOf(wizard)
        .filter((warning) => warning.code === 'UNREACHABLE')
        .map((warning) => warning.step),
    ).toEqual(['orphan'])
  })

  it('permits navigation cycles and reports each cycle once', () => {
    const wizard = defineWizard(
      { name: 'loops', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, view, steps }) =>
        steps({
          a: view({ input: z.string(), next: 'b' }),
          b: view({ input: z.string(), next: ['a', 'wait'] }),
          wait: step({
            waitFor: { ready: () => ({ done: true }) },
            timeout: { after: '1m', next: 'wait' },
            next: 'end',
          }),
          end: step({ run: () => true }),
        }),
    )
    expect(warningsOf(wizard).filter((warning) => warning.code === 'NAV_CYCLE')).toEqual([
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: a -> b -> a (allowed; make sure a guard, next function, or external event breaks it)',
        step: 'a',
        path: [],
      },
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: wait -> wait (allowed; make sure a guard, next function, or external event breaks it)',
        step: 'wait',
        path: [],
      },
    ])
  })

  it('keeps paths on nested warnings and replays warnings on a cached definition', () => {
    const childWizard = defineWizard({ name: 'child', context: z.object({}) }, ({ step, steps }) =>
      steps({ a: step({ run: () => true }), lost: step({ run: () => false }) }),
    )
    const wizard = defineWizard({ name: 'parent', context: z.object({}) }, ({ child, steps }) =>
      steps({ child: child(childWizard, { context: () => ({}) }) }),
    )
    const unreachable = (flow: AnyWizardDefinition) =>
      warningsOf(flow).filter((warning) => warning.code === 'UNREACHABLE')
    const expected = [
      {
        code: 'UNREACHABLE',
        message: "step 'lost' is not reachable from start",
        step: 'lost',
        path: ['child'],
      },
    ]
    expect(unreachable(wizard)).toEqual(expected)
    expect(unreachable(wizard)).toEqual(expected)
  })
})

describe('nesting validation', () => {
  it('collects a nesting cycle and independent sibling definition errors', () => {
    const embedded = rawStep({ context: () => ({}) }, 'child')
    const cyclic = rawFlow({
      bad: rawStep({ input: z.string(), next: 'missing' }, 'view'),
      embedded,
      sibling: rawStep(
        { context: () => ({}) },
        'child',
        rawFlow({ x: rawStep({ input: z.string(), next: 'ghost' }, 'view') }),
      ),
    })
    embedded.child = cyclic
    try {
      compile(cyclic)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      if (!(error instanceof WizardError)) throw error
      expect(error.code).toBe('NESTING_CYCLE')
      expect(error.step).toBe('embedded')
      expect(error.issues?.map((issue) => issue.message)).toEqual([
        "step 'bad': next: unknown step 'missing'",
        "wizard 'raw' embeds one of its ancestors (at step 'embedded')",
        "sibling: step 'x': next: unknown step 'ghost'",
      ])
    }
  })

  it('allows eight nesting levels and rejects the ninth', () => {
    let current = rawFlow({ end: rawStep({ run: () => true }) }, { name: 'leaf' })
    for (let level = 1; level <= 8; level += 1) {
      current = rawFlow(
        { child: rawStep({ context: () => ({}) }, 'child', current) },
        { name: `level-${level}` },
      )
    }
    expect(() => compile(current)).not.toThrow()
    const ninth = rawFlow(
      { child: rawStep({ context: () => ({}) }, 'child', current) },
      { name: 'ninth' },
    )
    try {
      compile(ninth)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      if (!(error instanceof WizardError)) throw error
      expect(error.code).toBe('NESTING_TOO_DEEP')
      expect(error.message).toContain('child/child/child/child/child/child/child/child/child')
    }
  })
})
