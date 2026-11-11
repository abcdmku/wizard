import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compile } from '../../src/authoring/compile'
import { RUN_ADAPTER } from '../../src/authoring/run-adapter'
import { WizardError } from '../../src/errors'
import { issuesOf, rawFlow, rawStep } from './helpers'

describe('compile validation for JavaScript definitions', () => {
  it('reports a malformed run adapter output as a definition issue', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow({
            work: rawStep({ run: { [RUN_ADAPTER]: { run: () => 1, output: {} } } }),
          }),
        ),
      ),
    ).toEqual(["step 'work': run adapter output must be a boundary"])
  })

  it('lists unknown ids across static references and entry points together', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            {
              a: rawStep({
                run: () => 1,
                next: ['b', 'missing-next'],
                needs: { gone: 'missing-need' },
                fallback: 'missing-fallback',
              }),
              b: rawStep({
                waitFor: { ready: () => ({ done: true }) },
                timeout: { after: '1m', next: 'missing-timeout' },
              }),
              route: rawStep({ next: () => 'a', targets: ['a', 'missing-target'] }),
            },
            { start: 'missing-start', events: { ready: z.boolean() } },
          ),
        ),
      ),
    ).toEqual([
      "step 'a': next: unknown step 'missing-next'",
      "step 'a': needs.gone: unknown step 'missing-need'",
      "step 'a': fallback: unknown step 'missing-fallback'",
      "step 'b': timeout.next: unknown step 'missing-timeout'",
      "step 'route': targets: unknown step 'missing-target'",
      "start: unknown step 'missing-start'",
    ])
  })

  it('rejects undeclared events and malformed handlers on each event boundary', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            {
              form: rawStep({ input: z.string(), on: { ghost: () => undefined } }, 'view'),
              work: rawStep({ run: () => 1, on: { known: 42 } }),
              wait: rawStep({ waitFor: { ghost: () => ({ done: true }), known: 'nope' } }),
            },
            {
              events: { known: z.string() },
              on: { ghost: () => undefined, known: 5 },
              correlate: { other: () => 'x', known: 'no' },
            },
          ),
        ),
      ),
    ).toEqual([
      "on['ghost']: the flow declares no event 'ghost'",
      "on['known'] must be a function",
      "correlate['other']: the flow declares no event 'other'",
      "correlate['known'] must be a function",
      "step 'form': on['ghost']: the wizard declares no event 'ghost'",
      "step 'work': on['known'] must be a function",
      "step 'wait': waitFor['ghost']: the wizard declares no event 'ghost'",
      "step 'wait': waitFor['known'] must be a function",
    ])
  })

  it.each<[Record<string, unknown>, string]>([
    [
      { run: () => 1, waitFor: { ready: () => ({ done: true }) } },
      "a step has one behavior: 'run', 'waitFor', or 'sleep'",
    ],
    [{ run: () => 1, sleep: '1s' }, "a step has one behavior: 'run', 'waitFor', or 'sleep'"],
    [
      { waitFor: { ready: () => ({ done: true }) }, sleep: '1s' },
      "a step has one behavior: 'run', 'waitFor', or 'sleep'",
    ],
    [{ next: () => null }, "a function 'next' must declare 'targets'"],
    [{ next: 'end', targets: ['end'] }, "'targets' requires a function 'next'"],
    [{ each: () => [], next: 'end' }, "'each' requires 'run'"],
    [{ retry: { retries: 1 }, next: 'end' }, "'retry' requires 'run'"],
    [{ fallback: 'end', next: 'end' }, "'fallback' requires 'run'"],
    [{ complete: true }, "'complete' is not an option of a step step"],
    [{ route: () => 'end' }, "'route' is not an option of a step step"],
  ])('rejects incompatible or removed options %j', (config, message) => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            {
              work: rawStep(config),
              end: rawStep({ run: () => true }),
            },
            { events: { ready: z.boolean() } },
          ),
        ),
      ),
    ).toEqual([`step 'work': ${message}`])
  })

  it('restricts waitFor to dedicated event steps and rejects view-only fields on tasks', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            {
              form: rawStep({ input: z.string(), waitFor: { ready: () => undefined } }, 'view'),
              work: rawStep({ run: () => 1, input: z.number(), canExit: () => true }),
              child: rawStep(
                { context: () => ({}), waitFor: { ready: () => undefined } },
                'flow',
                rawFlow({ end: rawStep({ run: () => true }) }),
              ),
            },
            { events: { ready: z.boolean() } },
          ),
        ),
      ),
    ).toEqual([
      "step 'form': 'waitFor' is not an option of a view step",
      "step 'work': 'input' is not an option of a step step",
      "step 'work': 'canExit' is not an option of a step step",
      "step 'child': 'waitFor' is not an option of a flow step",
    ])
  })

  it.each<[string, Record<string, unknown> | undefined, string]>([
    ['start', undefined, 'start must contain at least one step'],
    ['next', { next: [] }, "step 'work': next must contain at least one step"],
    [
      'targets',
      { next: () => null, targets: [] },
      "step 'work': targets must contain at least one step",
    ],
    [
      'needs.any',
      { run: () => 1, needs: { first: { any: [] } } },
      "step 'work': needs.first.any must contain at least one step",
    ],
    [
      'needs',
      { run: () => 1, needs: {} },
      "step 'work': 'needs' must contain at least one dependency",
    ],
    ['waitFor', { waitFor: {} }, "step 'work': 'waitFor' must contain at least one event handler"],
  ])('rejects an empty %s', (field, config, message) => {
    const flow = rawFlow(
      { work: rawStep(config ?? { run: () => 1 }) },
      field === 'start' ? { start: [] } : {},
    )
    expect(issuesOf(() => compile(flow))).toEqual([message])
  })

  it('rejects an empty step map', () => {
    expect(issuesOf(() => compile(rawFlow({})))).toEqual(['flow has no steps'])
  })

  it.each([0, -1, 1.5, Number.NaN, null])(
    'rejects invalid per-item concurrency %s',
    (concurrency) => {
      expect(
        issuesOf(() =>
          compile(
            rawFlow({
              work: rawStep({ each: () => [1, 2], run: () => 1, concurrency }),
            }),
          ),
        ),
      ).toEqual(["step 'work': 'concurrency' must be a positive integer or Infinity"])
    },
  )

  it('rejects item options without each and malformed each/key functions', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow({
            work: rawStep({ run: () => 1, concurrency: 2, key: () => 'key' }),
            badItems: rawStep({ run: () => 1, each: [1, 2] }),
            badKey: rawStep({ run: () => 1, each: () => [1, 2], key: 'key' }),
          }),
        ),
      ),
    ).toEqual([
      "step 'work': 'concurrency' requires 'each'",
      "step 'work': 'key' requires 'each'",
      "step 'badItems': 'each' must be a function",
      "step 'badKey': 'key' must be a function",
    ])
  })

  it('reports needs cycles, including any-needs and self dependencies', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow({
            a: rawStep({ run: () => 1, needs: { b: 'b' } }),
            b: rawStep({ run: () => 1, needs: { c: 'c' } }),
            c: rawStep({ run: () => 1, needs: { first: { any: ['a'] } } }),
            self: rawStep({ run: () => 1, needs: { self: 'self' } }),
          }),
        ),
      ),
    ).toEqual(['dependency cycle: a -> b -> c -> a', 'dependency cycle: self -> self'])
  })

  it('returns DEFINITION_INVALID and includes each issue in its message', () => {
    try {
      compile(rawFlow({ work: rawStep({ run: () => 1, next: 'missing', timeout: '3 weeks' }) }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      if (!(error instanceof WizardError)) throw error
      expect(error.code).toBe('DEFINITION_INVALID')
      expect(error.issues).toEqual([
        { message: "step 'work': next: unknown step 'missing'" },
        {
          message:
            "step 'work': timeout: invalid duration: '3 weeks' (expected e.g. '250ms', '15s', '15m', '2h', '1d')",
        },
      ])
      expect(error.message).toContain("flow 'raw' is invalid:")
      for (const issue of error.issues ?? []) expect(error.message).toContain(`- ${issue.message}`)
    }
  })
})
