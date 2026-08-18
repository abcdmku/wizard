import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'

const STEP_KEYS = [
  'kind',
  '~types',
  '~bound',
  'label',
  'dependsOn',
  'next',
  'on',
  'when',
  'input',
  'initial',
  'validate',
  'canEnter',
  'canExit',
  'enter',
  'exit',
  'run',
  'output',
  'retry',
  'timeout',
  'compensate',
  'idempotent',
  'mapError',
  'child',
  'context',
  'deps',
]

describe('defineFlow: step records', () => {
  const s = defineFlow({ name: 'shape', context: boundary.trusted<{ a: string }>() })

  it('materialises every key on every kind (undefined when unset), with ~types/~bound undefined', () => {
    const run = async () => 1
    const records = {
      view: s.view({ next: 'final' }),
      task: s.task(run, { next: 'final' }),
      decision: s.decision({ next: () => 'final' }),
      final: s.final(),
    }
    for (const [kind, rec] of Object.entries(records)) {
      expect(Object.keys(rec)).toEqual(STEP_KEYS)
      expect(rec.kind).toBe(kind)
      expect(rec['~types']).toBeUndefined()
      expect(rec['~bound']).toBeUndefined()
    }
    expect(records.task.run).toBe(run)
    expect(records.view.next).toBe('final')
    expect(records.final.next).toBeUndefined()
    expect(records.final.label).toBeUndefined()
  })

  it('wait and flow records carry their kind-specific fields', () => {
    const child = s.steps({ end: s.final() })
    const se = defineFlow({
      name: 'events',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>() },
    })
    const handler = () => {}
    const wait = se.wait({
      on: { ping: handler },
      timeout: { after: '1m', next: 'end' },
      next: 'end',
    })
    expect(Object.keys(wait)).toEqual(STEP_KEYS)
    expect(wait.on).toEqual({ ping: handler })
    expect(wait.timeout).toEqual({ after: '1m', next: 'end' })
    const ctx = () => ({ a: 'x' })
    const flow = s.flow(child, { context: ctx, next: 'end' })
    expect(Object.keys(flow)).toEqual(STEP_KEYS)
    expect(flow.child).toBe(child)
    expect(flow.context).toBe(ctx)
  })

  it('never shares field objects between records', () => {
    const a = s.view({ next: 'b' })
    const b = s.view({ next: 'a' })
    expect(a).not.toBe(b)
    expect(a.next).toBe('b')
    expect(b.next).toBe('a')
  })
})

describe('defineFlow: flow object', () => {
  it('holds name/version/boundaries/policies/steps/start and ~types undefined; omitted options are absent', () => {
    const context = z.object({ a: z.string() })
    const s = defineFlow({
      name: 'flow',
      version: 3,
      context,
      onFailure: 'compensate',
      concurrency: 2,
    })
    const steps = { a: s.view({ next: 'b' }), b: s.final() }
    const flow = s.steps(steps, { start: 'a' })
    expect(flow['~types']).toBeUndefined()
    expect(flow.name).toBe('flow')
    expect(flow.version).toBe(3)
    expect(flow.context).toBe(context)
    expect(flow.steps).toBe(steps)
    expect(flow.start).toBe('a')
    expect(flow.onFailure).toBe('compensate')
    expect(flow.concurrency).toBe(2)
    expect('events' in flow).toBe(false)
    expect('deps' in flow).toBe(false)
    expect('retry' in flow).toBe(false)
    expect('autoRun' in flow).toBe(false)
    expect('unmatchedEvents' in flow).toBe(false)
    const minimal = defineFlow({ name: 'min', context }).steps({ a: s.final() })
    expect('start' in minimal).toBe(false)
    expect('version' in minimal).toBe(false)
  })

  it('validates the definition header', () => {
    expect(() => defineFlow({ name: '', context: boundary.trusted<{}>() })).toThrow(WizardError)
    expect(() => defineFlow({ name: 'x', context: (() => {}) as any })).toThrowError(
      /'context' must be a boundary/,
    )
    expect(() =>
      defineFlow({ name: 'x', context: boundary.trusted(), events: { e: 42 as any } }),
    ).toThrowError(/events\['e'\] must be a boundary/)
    try {
      defineFlow({ name: 'x', context: boundary.trusted(), version: -1, deps: 'nope' as any })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WizardError)
      expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      expect((error as WizardError).issues?.map((i) => i.message)).toEqual([
        "'version' must be a non-negative integer",
        "'deps' must be a boundary",
      ])
    }
  })

  it('validates the assembled flow at definition time (unknown ids, JS callers)', () => {
    const s = defineFlow({ name: 'bad', context: boundary.trusted<{ a: string }>() })
    expect(() =>
      s.steps({
        a: s.view({ next: 'typo' as any }),
        b: s.final(),
      }),
    ).toThrowError(/next: unknown step 'typo'/)
  })
})
