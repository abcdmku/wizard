/**
 * `compile()` — definition problems (all listed at once) and per-kind allow-lists.
 */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { compile } from '../../src/authoring/compile'
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

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof WizardError) return (error.issues ?? []).map((i) => i.message)
    throw error
  }
  throw new Error('expected a WizardError')
}

describe('compile: validation errors (all problems listed at once)', () => {
  it('unknown ids in next/dependsOn/timeout.next/start, final with next, wait without handlers/timeout, input on non-view', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            a: { kind: 'view', next: ['b', 'nope'] },
            b: {
              kind: 'task',
              run: () => 1,
              dependsOn: ['ghost'],
              input: boundary.trusted(),
              next: 'w',
            },
            w: { kind: 'wait', on: {}, timeout: { after: '1m', next: 'missing' } },
            w2: { kind: 'wait', on: {} },
            end: { kind: 'final', next: 'a' },
          },
          { start: 'zzz', events: {} },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 'a': next: unknown step 'nope'",
      "step 'b': dependsOn: unknown step 'ghost'",
      "step 'b': only view steps accept 'input' (kind 'task')",
      "step 'w': timeout.next: unknown step 'missing'",
      "step 'w2': a wait with no handlers and no timeout can never complete",
      "step 'end': a final step cannot have next",
      "start: unknown step 'zzz'",
    ])
  })

  it('handlers for undeclared events, malformed hooks, missing run/next/context/child, bad policies', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            t: { kind: 'task', enter: 42, next: 'd' },
            d: { kind: 'decision' },
            w: { kind: 'wait', on: { ghost: () => {}, bad: 'x' }, next: 'f' },
            f: { kind: 'flow', next: 'x' },
            x: { kind: 'nope' },
            y: { kind: 'final', label: 3 },
          },
          {
            events: { bad: boundary.trusted() },
            onFailure: 'explode',
            autoRun: 'never',
            concurrency: 0,
            unmatchedEvents: { buffer: 'yes' },
            retry: { attempts: 'x' },
          },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 't': 'enter' must be a function",
      "step 't': a task needs a 'run' function",
      "step 'd': a decision needs a 'next' function",
      "step 'w': on['ghost']: the flow declares no event 'ghost'",
      "step 'w': on['bad'] must be a function",
      "step 'f': a flow step needs a child flow (s.flow(child, cfg))",
      "steps['x'] is not a step (build steps with s.view/task/wait/decision/flow/final)",
      "step 'y': 'label' must be a string",
      "onFailure must be 'halt' | 'compensate'",
      "autoRun must be 'ready' | 'manual'",
      'concurrency must be a number >= 1',
      'unmatchedEvents must be { buffer, ttl }',
      'retry.attempts must be a non-negative integer',
    ])
  })

  it('dependency cycles (each reported once), self-dependency, bad durations, empty flow, missing name/context', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow({
          a: { kind: 'task', run: () => 1, dependsOn: ['b'], next: 'b' },
          b: { kind: 'task', run: () => 1, dependsOn: ['c'], next: 'c' },
          c: { kind: 'task', run: () => 1, dependsOn: ['a'], timeout: '3 weeks', next: 'me' },
          me: { kind: 'task', run: () => 1, dependsOn: ['me'] },
        }),
      ),
    )
    expect(problems).toEqual([
      "step 'c': timeout: invalid duration: '3 weeks' (expected e.g. '250ms', '15s', '15m', '2h', '1d')",
      'dependency cycle: a -> b -> c -> a',
      'dependency cycle: me -> me',
    ])
    expect(issuesOf(() => compile(rawFlow({})))).toEqual(['flow has no steps'])
    expect(
      issuesOf(() =>
        compile({
          steps: { a: { kind: 'final', '~types': undefined } },
          context: 'nope',
        } as unknown as AnyFlow),
      ),
    ).toEqual(["'name' must be a non-empty string", "'context' must be a boundary"])
  })

  it('throws WizardError DEFINITION_INVALID with a message listing every problem', () => {
    try {
      compile(rawFlow({ a: { kind: 'view', next: 'x' }, b: { kind: 'final', next: 'a' } }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      const e = error as WizardError
      expect(e.code).toBe('DEFINITION_INVALID')
      expect(e.message).toContain("flow 'raw' is invalid:")
      expect(e.message).toContain("- step 'a': next: unknown step 'x'")
      expect(e.message).toContain("- step 'b': a final step cannot have next")
    }
  })

  it('per-kind allow-lists: a field another kind owns is a problem naming the kinds that accept it', () => {
    const problems = issuesOf(() =>
      compile(
        rawFlow(
          {
            // `on: {}` is accepted on a view since v0.2 (any kind may listen)
            v: { kind: 'view', run: () => 1, retry: { attempts: 1 }, on: {}, next: 't' },
            t: {
              kind: 'task',
              run: () => 1,
              input: boundary.trusted(),
              canExit: () => true,
              next: 'w',
            },
            w: { kind: 'wait', on: { e: () => {} }, compensate: () => {}, child: {}, next: 'd' },
            d: {
              kind: 'decision',
              next: () => 'f',
              enter: () => {},
              timeout: 5,
              idempotent: true,
              mapError: () => 1,
            },
            f: { kind: 'flow', child: undefined, context: () => ({}), initial: {}, next: 'end' },
            end: { kind: 'final', validate: () => {}, exit: () => {}, when: () => true },
          },
          { events: { e: boundary.trusted() } },
        ),
      ),
    )
    expect(problems).toEqual([
      "step 'v': only task steps accept 'run' (kind 'view')",
      "step 'v': only task steps accept 'retry' (kind 'view')",
      "step 't': only view steps accept 'input' (kind 'task')",
      "step 't': only view steps accept 'canExit' (kind 'task')",
      "step 'w': only task steps accept 'compensate' (kind 'wait')",
      "step 'w': only flow steps accept 'child' (kind 'wait')",
      "step 'd': only view/task/wait steps accept 'enter' (kind 'decision')",
      "step 'd': only task/wait steps accept 'timeout' (kind 'decision')",
      "step 'd': only task steps accept 'idempotent' (kind 'decision')",
      "step 'd': only task steps accept 'mapError' (kind 'decision')",
      "step 'f': only view steps accept 'initial' (kind 'flow')",
      "step 'f': a flow step needs a child flow (s.flow(child, cfg))",
      "step 'end': only view steps accept 'validate' (kind 'final')",
      "step 'end': only view/task/wait/flow steps accept 'exit' (kind 'final')",
      "step 'end': only view/task/wait/decision/flow steps accept 'when' (kind 'final')",
    ])
  })
})
