import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compile } from '../../src/authoring/compile'
import { resolveReferences } from '../../src/authoring/references'
import { defineWizard } from '../../src/wizard/define-wizard'
import { hookArgs, rawFlow, rawStep } from './helpers'

describe('step identity resolution', () => {
  it('resolves objects in every static reference position to the declared id', () => {
    const wizard = defineWizard(
      { name: 'refs', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, steps }) => {
        const end = step({ run: () => 'end' })
        const other = step({ run: () => 2 })
        return steps(
          {
            work: step({ run: () => 1, next: end, fallback: other, dependsOn: [other] }),
            route: step({ next: () => end, targets: [end, other] }),
            wait: step({
              waitFor: { ready: () => ({ done: true }) },
              timeout: { after: '1m', next: end },
              dependsOn: { any: [other, 'work'] },
            }),
            join: step({
              needs: { value: end, chosen: { any: [end, other] }, maybe: { optional: other } },
              run: () => true,
            }),
            end,
            other,
          },
          { start: 'route' },
        )
      },
    )
    const def = compile(wizard)
    expect(def.steps.work?.next).toEqual({ kind: 'static', targets: ['end'] })
    expect(def.steps.work?.fallback).toBe('other')
    expect(def.steps.work?.dependsOn).toEqual({ all: ['other'] })
    expect(def.steps.route?.next).toEqual({ kind: 'dynamic', targets: ['end', 'other'] })
    expect(def.steps.wait?.waitTimeout).toEqual({ afterMs: 60_000, next: 'end' })
    expect(def.steps.wait?.dependsOn).toEqual({ any: ['other', 'work'] })
    expect(def.steps.join?.needs).toEqual({
      value: { kind: 'all', steps: ['end'] },
      chosen: { kind: 'any', steps: ['end', 'other'] },
      maybe: { kind: 'optional', steps: ['other'] },
    })
  })

  it('resolves synchronous and asynchronous dynamic results with mixed spellings', async () => {
    const wizard = defineWizard(
      { name: 'dynamic-refs', context: z.object({}) },
      ({ step, steps }) => {
        const end = step({ run: () => 'end' })
        return steps({
          sync: step({ next: () => [end, 'end'], targets: [end] }),
          async: step({ next: async () => end, targets: ['end'] }),
          end,
        })
      },
    )
    const def = compile(wizard)
    expect(await def.steps.sync?.hooks.next?.(hookArgs())).toEqual(['end', 'end'])
    expect(await def.steps.async?.hooks.next?.(hookArgs())).toBe('end')
  })

  it.each([
    'next',
    'targets',
    'dependsOn',
    'dependsOn.any',
    'fallback',
    'timeout.next',
    'needs',
    'needs.any',
    'needs.optional',
  ])('rejects an orphan object in %s', (position) => {
    const orphan = rawStep({ run: () => 1 })
    const options: Record<string, Record<string, unknown>> = {
      next: { next: orphan },
      targets: { next: () => null, targets: [orphan] },
      dependsOn: { dependsOn: [orphan] },
      'dependsOn.any': { dependsOn: { any: [orphan] } },
      fallback: { fallback: orphan },
      'timeout.next': {
        waitFor: { e: () => ({ done: true }) },
        timeout: { after: '1m', next: orphan },
      },
      needs: { needs: { value: orphan } },
      'needs.any': { needs: { value: { any: [orphan] } } },
      'needs.optional': { needs: { value: { optional: orphan } } },
    }
    const flow = rawFlow({ work: rawStep(options[position] ?? {}) })
    const location = position.startsWith('needs')
      ? position.replace('needs', 'needs.value')
      : position
    expect(() => resolveReferences(flow.steps)).toThrow(
      `step 'work' ${location}: a step reference must belong to this wizard under exactly one ID`,
    )
  })

  it('rejects a reference whose object is registered under two ids', () => {
    const shared = rawStep({ run: () => 1 })
    expect(() =>
      resolveReferences(
        rawFlow({ first: shared, second: shared, work: rawStep({ next: shared }) }).steps,
      ),
    ).toThrow("A step object belongs to multiple IDs: 'first', 'second'")
  })

  it('rejects foreign dynamic references when the callback returns them', async () => {
    const foreign = rawStep({ run: () => 1 })
    const flow = rawFlow({
      work: rawStep({ next: async () => foreign, targets: ['end'] }),
      end: rawStep({ run: () => 2 }),
    })
    const normalized = resolveReferences(flow.steps)
    const def = compile(rawFlow(normalized))
    await expect(async () => def.steps.work?.hooks.next?.(hookArgs())).rejects.toThrow(
      "step 'work' next: a step reference must belong to this wizard under exactly one ID",
    )
  })

  it.each([
    ['needs.value', 'end'],
    ['needs.value.any', { any: ['end'] }],
    ['needs.value.optional', { optional: 'end' }],
  ])('rejects a string id in authored %s', (location, need) => {
    const flow = rawFlow({
      work: rawStep({ needs: { value: need }, run: () => 1 }),
      end: rawStep({ run: () => 2 }),
    })
    expect(() => resolveReferences(flow.steps)).toThrow(
      `step 'work' ${location}: a need requires a step object, not an id string`,
    )
  })
})
