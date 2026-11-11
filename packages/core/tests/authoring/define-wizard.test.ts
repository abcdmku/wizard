import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { buildFlow } from '../../src/authoring/build-flow'
import { compile } from '../../src/authoring/compile'
import { WizardError } from '../../src/errors'
import { defineWizard } from '../../src/wizard/define-wizard'
import { issuesOf, rawFlow, rawStep } from './helpers'

/** The JavaScript caller boundary deliberately accepts malformed constructor arguments. */
interface JavaScriptApi {
  step(...args: unknown[]): unknown
  view(config: unknown): unknown
  flow(child: unknown, config: unknown): unknown
  steps(map: unknown, options?: unknown): unknown
}

describe('defineWizard assembly', () => {
  it('builds once, returns the flow itself, and starts from the declared entry', async () => {
    let builds = 0
    const calls: string[] = []
    const wizard = defineWizard(
      { name: 'assembled', version: 3, context: z.object({ name: z.string() }) },
      ({ step, steps }) => {
        builds += 1
        const ignored = step({ run: () => calls.push('ignored') })
        const chosen = step({ run: ({ context }) => `hello ${context.name}` })
        return steps({ ignored, chosen }, { start: 'chosen' })
      },
    )

    expect(wizard.name).toBe('assembled')
    expect(wizard.version).toBe(3)
    expect(compile(wizard).identity).toBe(wizard)
    expect(await wizard.run({ name: 'Ada' })).toMatchObject({ status: 'done', output: 'hello Ada' })
    expect(await wizard.run({ name: 'Lin' })).toMatchObject({ status: 'done', output: 'hello Lin' })
    expect(builds).toBe(1)
    expect(calls).toEqual([])
  })

  it('uses declaration order as the default entry', async () => {
    const wizard = defineWizard(
      { name: 'default-entry', context: z.object({}) },
      ({ step, steps }) =>
        steps({ first: step({ run: () => 'first' }), second: step({ run: () => 'second' }) }),
    )
    expect(await wizard.run({})).toMatchObject({ status: 'done', output: 'first' })
  })

  it('passes the wizard directly to a child flow', async () => {
    const child = defineWizard(
      { name: 'child', context: z.object({ n: z.number() }) },
      ({ step, steps }) => steps({ done: step({ run: ({ context }) => context.n * 2 }) }),
    )
    const parent = defineWizard(
      { name: 'parent', context: z.object({ n: z.number() }) },
      ({ flow, steps }) => steps({ child: flow(child, { context: ({ context }) => context }) }),
    )
    expect(await parent.run({ n: 4 })).toMatchObject({ status: 'done', output: 8 })
  })

  it('rejects an invalid header and lists every header problem', () => {
    expect(
      issuesOf(() =>
        compile(rawFlow({ done: rawStep({ run: () => true }) }, { name: '', context: 'nope' })),
      ),
    ).toEqual(["'name' must be a non-empty string", "'context' must be a boundary"])
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            { done: rawStep({ run: () => true }) },
            { version: -1, deps: 'nope', events: { e: 42 } },
          ),
        ),
      ),
    ).toEqual([
      "'version' must be a non-negative integer",
      "events['e'] must be a boundary",
      "'deps' must be a boundary",
    ])
  })

  it('rejects unknown step ids while assembling a JavaScript definition', () => {
    try {
      compile(rawFlow({ form: rawStep({ input: boundary.trusted(), next: 'typo' }, 'view') }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      if (!(error instanceof WizardError)) throw error
      expect(error.code).toBe('DEFINITION_INVALID')
      expect(error.issues).toEqual([{ message: "step 'form': next: unknown step 'typo'" }])
    }
  })

  it('requires an assembly result from JavaScript build callbacks', () => {
    expect(() =>
      buildFlow({ name: 'unassembled', context: z.object({}) }, ({ step }: JavaScriptApi) => ({
        work: step({ run: () => 1 }),
      })),
    ).toThrow('wizard build must return steps(map, { start? })')
  })

  it('rejects positional step functions and malformed constructor configs', () => {
    for (const config of [() => 1, null, undefined, []]) {
      expect(() =>
        buildFlow({ name: 'bad-config', context: z.object({}) }, ({ step, steps }: JavaScriptApi) =>
          steps({ work: step(config, { retry: { retries: 1 } }) }),
        ),
      ).toThrow('step() requires an object config')
    }
  })

  it('parses child context and dependencies once at child creation', async () => {
    let contextParses = 0
    let depsParses = 0
    const child = defineWizard(
      {
        name: 'child-boundaries',
        context: z.object({ n: z.string() }).transform((value) => {
          contextParses += 1
          return { n: Number(value.n) }
        }),
        deps: boundary.assert((value): asserts value is { factor: number } => {
          depsParses += 1
          z.object({ factor: z.number() }).parse(value)
        }),
      },
      ({ step, steps }) =>
        steps({ work: step({ run: ({ context, deps }) => context.n * deps.factor }) }),
    )
    const parent = defineWizard(
      { name: 'child-mapping', context: z.object({}) },
      ({ flow, steps }) =>
        steps({
          child: flow(child, { context: () => ({ n: '4' }), deps: () => ({ factor: 2 }) }),
        }),
    )
    expect(await parent.run({})).toMatchObject({ status: 'done', output: 8 })
    expect(contextParses).toBe(1)
    expect(depsParses).toBe(1)
  })
})
