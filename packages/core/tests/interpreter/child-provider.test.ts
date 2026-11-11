import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { resolveDeps } from '../../src/interpreter/child-deps'
import { flow, routingStep } from '../helpers/fixtures'

const unusedArgs = (): HookArgs => {
  throw new Error('an inherited dependency does not call the mapper')
}

describe('child dependency boundaries', () => {
  it('combines providers with inherited deps before checking the child boundary', () => {
    const seen: unknown[] = []
    const childDef = {
      ...flow({ start: 'end', steps: { end: routingStep() } }),
      providedDeps: { service: 'bound', tenant: 'default' },
      deps: {
        kind: 'parse' as const,
        parse(value: unknown) {
          seen.push(value)
          return { ok: true as const, value: { service: 'validated' } }
        },
      },
    }
    const result = resolveDeps({
      step: 'child',
      mapper: undefined,
      childDef,
      parentDeps: { tenant: 'acme' },
      args: unusedArgs,
    })
    expect(seen).toEqual([{ service: 'bound', tenant: 'acme' }])
    expect(result).toEqual({ ok: true, value: { service: 'validated' } })
  })

  it('rejects inherited deps that fail the child boundary', () => {
    const childDef = {
      ...flow({ start: 'end', steps: { end: routingStep() } }),
      deps: {
        kind: 'guard' as const,
        parse() {
          return { ok: false as const, issues: [{ message: 'service is required' }] }
        },
      },
    }
    expect(
      resolveDeps({
        step: 'child',
        mapper: undefined,
        childDef,
        parentDeps: {},
        args: unusedArgs,
      }),
    ).toEqual({
      ok: false,
      error: {
        name: 'BoundaryError',
        code: 'BOUNDARY_REJECTED',
        message: "deps of child flow 'test' rejected by boundary: service is required",
      },
    })
  })
})
