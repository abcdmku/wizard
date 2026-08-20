/**
 * `compile()` — advisory warnings (reused by `inspect`) and nesting rules.
 */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { compile, type FlowWarning } from '../../src/authoring/compile'
import { defineFlow } from '../../src/authoring/define-flow'
import type { AnyFlow } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'

/** Hand-build a Flow object (JS-caller shape) around raw step records. */
function rawFlow(
  steps: Record<string, Partial<CompiledStepLike>>,
  extra: Record<string, unknown> = {},
): AnyFlow {
  return {
    '~types': undefined,
    name: 'raw',
    context: boundary.trusted(),
    steps: Object.fromEntries(
      Object.entries(steps).map(([id, s]) => [
        id,
        { '~types': undefined, '~bound': undefined, ...s },
      ]),
    ),
    ...extra,
  } as unknown as AnyFlow
}
type CompiledStepLike = Record<string, unknown> & { kind: string }

describe('compile: warnings (advisory, reused by inspect)', () => {
  const warn = defineFlow({ name: 'warn', context: boundary.trusted() })
  const collect = (flow: AnyFlow): FlowWarning[] => {
    const out: FlowWarning[] = []
    compile(flow, { onWarning: (w) => out.push(w) })
    return out
  }

  it('unreachable steps and dependsOn without incoming edges', () => {
    const flow = warn.steps(
      {
        a: warn.view({ next: 'b' }),
        b: warn.final(),
        orphan: warn.view({ next: 'b' }),
        gated: warn.task(async () => 1, { dependsOn: ['a'], next: 'b' }),
      },
      { start: 'a' },
    )
    expect(collect(flow)).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'orphan' is not reachable from start",
        step: 'orphan',
        path: [],
      },
      {
        code: 'NEVER_ACTIVATES',
        message:
          "step 'gated' declares dependsOn but has no incoming next/start edge, so it can never activate",
        step: 'gated',
        path: [],
      },
    ])
  })

  it('timeout targets and fan-out count as edges; a reachable dynamic next silences the analysis', () => {
    const edges = defineFlow({
      name: 'edges',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const flow = edges.steps({
      w: edges.wait({
        on: { e: () => {} },
        timeout: { after: '1m', next: 'late' },
        next: ['a', 'b'],
      }),
      a: edges.final(),
      b: edges.final(),
      late: edges.final(),
    })
    expect(collect(flow)).toEqual([])
    const dyn = warn.steps({
      d: warn.decision({ next: () => 'far' }),
      far: warn.final(),
      farther: warn.final(),
    })
    expect(collect(dyn)).toEqual([])
    const dynUnreached = warn.steps({
      a: warn.view({ next: 'b' }),
      b: warn.final(),
      d: warn.decision({ next: () => 'a' }),
    })
    expect(collect(dynUnreached).map((w) => w.step)).toEqual(['d'])
  })

  it('navigation cycles through next / timeout.next are advisory NAV_CYCLE warnings (each cycle once)', () => {
    const loops = defineFlow({
      name: 'loops',
      context: boundary.trusted(),
      events: { e: boundary.trusted() },
    })
    const flow = loops.steps({
      a: loops.view({ next: 'b' }),
      b: loops.view({ next: ['a', 'w'] }), // a → b → a
      w: loops.wait({ on: { e: () => {} }, timeout: { after: '1m', next: 'w' }, next: 'end' }), // w → w (timeout)
      end: loops.final(),
    })
    expect(collect(flow)).toEqual([
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: a -> b -> a (allowed; make sure a guard, a decision or a wait breaks it)',
        step: 'a',
        path: [],
      },
      {
        code: 'NAV_CYCLE',
        message:
          'navigation cycle: w -> w (allowed; make sure a guard, a decision or a wait breaks it)',
        step: 'w',
        path: [],
      },
    ])
    // Cycles are allowed: the flow compiles and a plain chain has no warning.
    expect(collect(warn.steps({ a: warn.view({ next: 'b' }), b: warn.final() }))).toEqual([])
  })

  it('nested flows report warnings with their path; onWarning is replayed from the cache', () => {
    const child = defineFlow({ name: 'child', context: boundary.trusted() })
    const childFlow = child.steps({ a: child.final(), lost: child.final() })
    const flow = warn.steps({
      f: warn.flow(childFlow, { context: () => ({}), next: 'e' }),
      e: warn.final(),
    })
    const first = collect(flow)
    expect(first).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'lost' is not reachable from start",
        step: 'lost',
        path: ['f'],
      },
    ])
    expect(collect(flow)).toEqual(first)
  })
})

describe('compile: nesting', () => {
  it('rejects a flow embedding one of its ancestors (NESTING_CYCLE)', () => {
    // A cycle can only be built by mutation after definition (warn.flow needs the child object).
    const cyclic = rawFlow({
      f: { kind: 'flow', child: undefined, context: () => ({}), next: 'e' },
      e: { kind: 'final' },
    })
    ;(cyclic.steps as unknown as Record<string, Record<string, unknown>>).f!.child = cyclic
    try {
      compile(cyclic)
      expect.unreachable()
    } catch (error) {
      expect((error as WizardError).code).toBe('NESTING_CYCLE')
      expect((error as WizardError).step).toBe('f')
    }
  })

  it('collects every problem of the tree before throwing: the nesting code wins, siblings are still reported', () => {
    const cyclic = rawFlow({
      bad: { kind: 'view', next: 'nope' },
      f: { kind: 'flow', child: undefined, context: () => ({}), next: 'e' },
      g: {
        kind: 'flow',
        child: rawFlow({ x: { kind: 'view', next: 'ghost' } }),
        context: () => ({}),
        next: 'e',
      },
      e: { kind: 'final' },
    })
    ;(cyclic.steps as unknown as Record<string, Record<string, unknown>>).f!.child = cyclic
    try {
      compile(cyclic)
      expect.unreachable()
    } catch (error) {
      const e = error as WizardError
      expect(e.code).toBe('NESTING_CYCLE')
      expect(e.step).toBe('f')
      expect(e.issues?.map((i) => i.message)).toEqual([
        "step 'bad': next: unknown step 'nope'",
        "flow 'raw' embeds one of its ancestors (at step 'f')",
        "g: step 'x': next: unknown step 'ghost'",
      ])
    }
  })

  it('allows 8 nested levels and rejects the 9th (NESTING_TOO_DEEP)', () => {
    const leaf = defineFlow({ name: 'leaf', context: boundary.trusted() })
    let current: AnyFlow = leaf.steps({ e: leaf.final() })
    for (let level = 1; level <= 8; level += 1) {
      const levelFlow = defineFlow({ name: `level${level}`, context: boundary.trusted() })
      current = levelFlow.steps({
        c: levelFlow.flow(current, { context: () => ({}), next: 'e' }),
        e: levelFlow.final(),
      })
    }
    const nine = defineFlow({ name: 'nine', context: boundary.trusted() })
    try {
      nine.steps({ c: nine.flow(current, { context: () => ({}), next: 'e' }), e: nine.final() })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      expect((error as WizardError).code).toBe('NESTING_TOO_DEEP')
      expect((error as WizardError).message).toContain('c/c/c/c/c/c/c/c/c')
    }
  })
})
