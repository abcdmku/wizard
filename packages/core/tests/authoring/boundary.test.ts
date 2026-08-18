import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, isBoundary, toRuntimeBoundary } from '../../src/authoring/boundary'
import { CHECKER } from '../../src/authoring/types'
import { WizardError } from '../../src/errors'

describe('boundary.*', () => {
  it('builds checkers branded with the private symbol (kind under the brand, no string tag)', () => {
    expect(boundary.parse((x) => String(x))[CHECKER]).toBe('parse')
    expect(boundary.guard((x): x is string => typeof x === 'string')[CHECKER]).toBe('guard')
    expect(
      boundary.assert((x): asserts x is string => {
        if (typeof x !== 'string') throw new Error('no')
      })[CHECKER],
    ).toBe('assert')
    expect(boundary.trusted<number>()[CHECKER]).toBe('trusted')
    expect('~checker' in boundary.trusted()).toBe(false)
    // The brand is a plain Symbol(), not Symbol.for: nothing outside the module can mint one.
    expect(Symbol.for('openwizard.checker')).not.toBe(CHECKER)
  })

  it('boundary.parse/guard/assert require a function (DEFINITION_INVALID otherwise)', () => {
    for (const build of [boundary.parse, boundary.guard, boundary.assert]) {
      expect(() => build('nope' as never)).toThrow(WizardError)
      try {
        build(undefined as never)
      } catch (error) {
        expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      }
    }
  })

  it('isBoundary recognises Standard Schemas and checkers, rejects plain functions', () => {
    expect(isBoundary(z.string())).toBe(true)
    expect(isBoundary(v.string())).toBe(true)
    expect(isBoundary(type('string'))).toBe(true)
    expect(isBoundary(boundary.trusted())).toBe(true)
    expect(isBoundary(() => true)).toBe(false)
    expect(isBoundary({ '~standard': {} })).toBe(false)
    expect(isBoundary(null)).toBe(false)
    expect(isBoundary('x')).toBe(false)
  })

  it('rejects forged checkers: string tags, unknown kinds, kinds without a function', () => {
    expect(isBoundary({ '~checker': 'assert' })).toBe(false)
    expect(isBoundary({ '~checker': 'trusted' })).toBe(false)
    expect(isBoundary({ [CHECKER]: 'weird', '~fn': () => 1 })).toBe(false)
    expect(isBoundary({ [CHECKER]: 'assert' })).toBe(false) // no function → accepts nothing, so not a boundary
    expect(isBoundary({ [CHECKER]: 'parse', '~fn': 'not a function' })).toBe(false)
    expect(isBoundary({ [CHECKER]: 'trusted' })).toBe(true) // the module shape itself
    for (const forged of [
      { '~checker': 'assert' },
      { [CHECKER]: 'assert' },
      { [CHECKER]: 'nope' },
    ]) {
      try {
        toRuntimeBoundary(forged as never)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError)
        expect((error as WizardError).code).toBe('DEFINITION_INVALID')
      }
    }
  })
})

describe('toRuntimeBoundary: checkers', () => {
  it('parse: returns the parsed value or the thrown message as an issue', () => {
    const b = toRuntimeBoundary(
      boundary.parse((x) => {
        if (typeof x !== 'string') throw new Error('expected a string')
        return x.toUpperCase()
      }),
    )
    expect(b.kind).toBe('parse')
    expect(b.parse('a')).toEqual({ ok: true, value: 'A' })
    expect(b.parse(1)).toEqual({ ok: false, issues: [{ message: 'expected a string' }] })
  })

  it('parse: an error carrying `issues` contributes them', () => {
    const b = toRuntimeBoundary(
      boundary.parse(() => {
        throw Object.assign(new Error('bad'), {
          issues: [{ message: 'too short', path: ['name'] }, { message: 'missing' }],
        })
      }),
    )
    expect(b.parse({})).toEqual({
      ok: false,
      issues: [{ message: 'too short', path: ['name'] }, { message: 'missing' }],
    })
  })

  it('guard: true → ok, false → one issue, throw → message', () => {
    const b = toRuntimeBoundary(boundary.guard((x): x is number => typeof x === 'number'))
    expect(b.kind).toBe('guard')
    expect(b.parse(1)).toEqual({ ok: true, value: 1 })
    expect(b.parse('x')).toEqual({ ok: false, issues: [{ message: 'value rejected by guard' }] })
    const throwing = toRuntimeBoundary(
      boundary.guard((_x): _x is number => {
        throw new Error('boom')
      }),
    )
    expect(throwing.parse(1)).toEqual({ ok: false, issues: [{ message: 'boom' }] })
  })

  it('assert: no throw → ok (same value), throw → issues', () => {
    const b = toRuntimeBoundary(
      boundary.assert((x): asserts x is { id: string } => {
        if (typeof x !== 'object' || x === null || !('id' in x)) throw new TypeError('needs id')
      }),
    )
    expect(b.kind).toBe('assert')
    const value = { id: 'a' }
    expect(b.parse(value)).toEqual({ ok: true, value })
    expect(b.parse(null)).toEqual({ ok: false, issues: [{ message: 'needs id' }] })
  })

  it('trusted: passes anything through', () => {
    const b = toRuntimeBoundary(boundary.trusted<number>())
    expect(b.kind).toBe('trusted')
    expect(b.parse('anything')).toEqual({ ok: true, value: 'anything' })
  })

  it('rejects non-boundaries with DEFINITION_INVALID', () => {
    expect(() => toRuntimeBoundary((() => 1) as any)).toThrow(WizardError)
    try {
      toRuntimeBoundary((() => 1) as any)
    } catch (error) {
      expect((error as WizardError).code).toBe('DEFINITION_INVALID')
    }
  })
})

describe('toRuntimeBoundary: Standard Schema', () => {
  it('Zod 4: sync validate; issues keep message + path', () => {
    const b = toRuntimeBoundary(
      z.object({ qty: z.string().transform(Number), tag: z.string().min(2) }),
    )
    expect(b.kind).toBe('standard')
    expect(b.parse({ qty: '2', tag: 'ok' })).toEqual({ ok: true, value: { qty: 2, tag: 'ok' } })
    const bad = b.parse({ qty: '2', tag: 'x' })
    expect(bad).toMatchObject({ ok: false })
    if (bad instanceof Promise || bad.ok) throw new Error('expected sync failure')
    expect(bad.issues).toHaveLength(1)
    expect(bad.issues[0]?.path).toEqual(['tag'])
    expect(typeof bad.issues[0]?.message).toBe('string')
  })

  it('Valibot and ArkType', () => {
    const vb = toRuntimeBoundary(v.object({ n: v.optional(v.number(), 0) }))
    expect(vb.parse({})).toEqual({ ok: true, value: { n: 0 } })
    expect(vb.parse({ n: 'x' })).toMatchObject({ ok: false })
    const ab = toRuntimeBoundary(type({ c: 'boolean' }))
    expect(ab.parse({ c: true })).toEqual({ ok: true, value: { c: true } })
    expect(ab.parse({ c: 1 })).toMatchObject({ ok: false })
  })

  it('async validate → parse resolves a promise; issue paths with segments and undefined paths are normalised', async () => {
    const schema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) =>
          typeof value === 'string'
            ? { value }
            : {
                issues: [
                  { message: 'not a string', path: [{ key: 'root' }, 0] },
                  { message: 'nope', path: undefined },
                ],
              },
      },
    }
    const b = toRuntimeBoundary(schema)
    const ok = b.parse('x')
    expect(ok).toBeInstanceOf(Promise)
    expect(await ok).toEqual({ ok: true, value: 'x' })
    expect(await b.parse(1)).toEqual({
      ok: false,
      issues: [{ message: 'not a string', path: [{ key: 'root' }, 0] }, { message: 'nope' }],
    })
  })
})
