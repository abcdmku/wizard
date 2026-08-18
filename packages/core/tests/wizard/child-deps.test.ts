/**
 * Nested flow adapters end to end (review finding 4): a flow step's `context` / `deps` mappers
 * are compiled RAW and each mapped value crosses the child's boundary EXACTLY once, at child
 * creation (a transform-style Zod context boundary would fail if it ran twice); `deps` is
 * mapped + parsed through the child's `deps` boundary, or the parent's deps object passes
 * through unchanged; mapper / boundary problems fail the flow step as `kind: 'child'`.
 * Also: decision output parity (finding 5) and the user-transaction `NavResult` (15a).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { createWizard, resumeWizard, type StepState } from '../../src/wizard/create-wizard'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface ParentDeps {
  svc: { name: string }
  extra: number
}
interface ChildDeps {
  svc: { name: string }
  parsed: boolean
}

describe('nested flow adapters: context / deps cross the child boundary once', () => {
  const setup = () => {
    let contextParses = 0
    let depsParses = 0
    const c = defineFlow({
      name: 'child',
      // Transform-style boundary: a string INPUT becomes a number OUTPUT — parsing the OUTPUT
      // again would fail (`Number` is not a string), so this proves the boundary runs once.
      context: z.object({
        n: z.string().transform((v) => {
          contextParses += 1
          return Number(v)
        }),
      }),
      deps: boundary.parse((v): ChildDeps => {
        depsParses += 1
        if (typeof v !== 'object' || v === null || !('svc' in v)) throw new Error('svc missing')
        return { svc: (v as { svc: { name: string } }).svc, parsed: true }
      }),
    })
    const seen: { context: unknown; deps: unknown }[] = []
    const child = c.steps({
      work: c.task(
        ({ context, deps }) => {
          seen.push({ context, deps })
          return context.n * 2
        },
        { next: 'end' },
      ),
      end: c.final({ output: ({ context }) => context.n }),
    })
    // A deps-less child: it must receive the parent's deps object unchanged.
    const p = defineFlow({ name: 'plain', context: boundary.trusted<{ ok: boolean }>() })
    const plainSeen: unknown[] = []
    const plain = p.steps({
      look: p.task(
        ({ deps }) => {
          plainSeen.push(deps)
          return 1
        },
        { next: 'end' },
      ),
      end: p.final(),
    })
    const s = defineFlow({
      name: 'parent',
      context: z.object({ raw: z.string() }),
      deps: boundary.trusted<ParentDeps>(),
    })
    const parent = s.steps(
      {
        sub: s.flow(child, {
          context: ({ context }) => ({ n: context.raw }),
          deps: ({ deps }) => ({ svc: deps.svc }) as unknown as ChildDeps,
          next: 'fallback',
        }),
        fallback: s.flow(plain, { context: () => ({ ok: true }), next: 'done' }),
        done: s.final({ output: ({ steps }) => steps.sub?.output }),
      },
      { start: 'sub' },
    )
    const parentDeps: ParentDeps = { svc: { name: 'inventory' }, extra: 1 }
    const wizard = createWizard(parent, {
      context: { raw: '21' },
      deps: parentDeps,
      scheduler: createTestScheduler({ now: 1_000 }),
      ids: createSequentialIds(),
      instanceId: 'p-1',
    })
    return {
      wizard,
      parent,
      parentDeps,
      seen,
      plainSeen,
      parses: () => ({ context: contextParses, deps: depsParses }),
    }
  }

  it('parses the mapped context once (transform), maps + parses deps once, passes parent deps through unchanged', async () => {
    const t = setup()
    await t.wizard.start()
    await tick()
    await tick()
    expect(t.parses()).toEqual({ context: 1, deps: 1 })
    expect(t.seen).toEqual([
      { context: { n: 21 }, deps: { svc: { name: 'inventory' }, parsed: true } },
    ])
    expect(t.wizard.getState().steps.sub.output).toBe(21)
    // The child's deps object is the PARSED value, not the parent's object.
    expect(t.seen[0]?.deps).not.toBe(t.parentDeps)
    // The deps-less child got the parent's deps object itself.
    expect(t.plainSeen).toHaveLength(1)
    expect(t.plainSeen[0]).toBe(t.parentDeps)
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().output).toBe(21)
    t.wizard.dispose()
  })

  it('a throwing deps mapper / a rejecting deps boundary fails the flow step (kind child), context untouched', async () => {
    const c = defineFlow({
      name: 'child',
      context: boundary.trusted<{ n: number }>(),
      deps: boundary.guard(
        (v): v is { svc: string } => typeof v === 'object' && v !== null && 'svc' in v,
      ),
    })
    const child = c.steps({ end: c.final() })
    const s = defineFlow({ name: 'parent', context: boundary.trusted<{ n: number }>() })
    const throwing = s.steps({
      f: s.flow(child, {
        context: ({ context }) => ({ n: context.n }),
        deps: () => {
          throw new Error('no deps for you')
        },
        next: 'e',
      }),
      e: s.final(),
    })
    const w1 = createWizard(throwing, { context: { n: 1 } })
    await w1.start()
    expect(w1.getState().steps.f).toMatchObject({
      status: 'failed',
      error: { kind: 'child', message: 'no deps for you' },
    })
    expect(w1.getState().status).toBe('failed')
    w1.dispose()

    const rejecting = s.steps({
      f: s.flow(child, {
        context: ({ context }) => ({ n: context.n }),
        deps: () => ({ nope: 1 }) as never,
        next: 'e',
      }),
      e: s.final(),
    })
    const w2 = createWizard(rejecting, { context: { n: 1 } })
    await w2.start()
    expect(w2.getState().steps.f).toMatchObject({
      status: 'failed',
      error: { kind: 'child', code: 'BOUNDARY_REJECTED' },
    })
    expect(w2.getState().steps.f.error?.message).toContain("deps of child flow 'child' rejected")
    w2.dispose()
  })

  it('re-runs the deps mapper on restore (deps are never persisted); the child keeps its parsed deps', async () => {
    const t = setup()
    const store = createMemoryStore()
    // Recreate with a store so the running child is persisted, then resume from it.
    const c = defineFlow({
      name: 'child',
      context: boundary.trusted<{ n: number }>(),
      deps: boundary.parse((v) => ({ ...(v as { svc: string }), parsed: true })),
    })
    const depsSeen: unknown[] = []
    const child = c.steps({
      wait: c.view({ enter: ({ deps }) => depsSeen.push(deps), next: 'end' }),
      end: c.final(),
    })
    const s = defineFlow({
      name: 'parent',
      context: boundary.trusted<{ n: number }>(),
      deps: boundary.trusted<{ svc: string }>(),
    })
    let mapperCalls = 0
    const parent = s.steps({
      f: s.flow(child, {
        context: ({ context }) => ({ n: context.n }),
        deps: ({ deps }) => {
          mapperCalls += 1
          return { svc: deps.svc, parsed: true }
        },
        next: 'e',
      }),
      e: s.final(),
    })
    const first = createWizard(parent, { context: { n: 1 }, deps: { svc: 'a' }, store, key: 'k' })
    await first.start()
    expect(mapperCalls).toBe(1)
    expect(depsSeen).toEqual([{ svc: 'a', parsed: true }])
    expect(first.child('f').getState().current).toBe('wait')
    await first.save()
    first.dispose()

    const resumed = resumeWizard(parent, await store.get('k'), { deps: { svc: 'b' } })
    expect(mapperCalls).toBe(2) // mapped again at restore, from the NEW parent deps
    // The restored child continues with the freshly mapped + parsed deps.
    depsSeen.length = 0
    expect(
      await resumed.dispatch({ type: 'child', path: ['f'], command: { type: 'next' } }),
    ).toMatchObject({ ok: true })
    expect(resumed.child('f').getState().status).toBe('done')
    resumed.dispose()
    t.wizard.dispose()
  })
})

describe('decision output parity and the user transaction of next()', () => {
  const s = defineFlow({ name: 'routes', context: boundary.trusted<{ n: number }>() })
  const flow = s.steps(
    {
      form: s.view({ next: 'route' }),
      route: s.decision({ next: ({ context }) => (context.n > 0 ? 'yes' : ['yes', 'no']) }),
      yes: s.view({ next: 'end' }),
      no: s.view({ next: 'end' }),
      end: s.final(),
    },
    { start: 'form' },
  )

  it('StepState<F, decision>.output is the normalized target list at runtime too', async () => {
    const wizard = createWizard(flow, { context: { n: 1 } })
    await wizard.start()
    await wizard.next()
    const route: StepState<typeof flow, 'route'> = wizard.getState().steps.route
    // Type: readonly ('yes' | 'no')[] | undefined — runtime: ['yes'] (a string target is normalized).
    const output: readonly ('yes' | 'no')[] | undefined = route.output
    expect(output).toEqual(['yes'])
    wizard.dispose()
  })

  it('next() reports the user transaction when a cursor-rule auto transition commits in the same batch', async () => {
    const wizard = createWizard(flow, { context: { n: 1 } })
    await wizard.start()
    // form → route (user tx) → yes (auto: decision + cursor rule) in one batch.
    const result = await wizard.next()
    expect(result).toMatchObject({ ok: true, from: 'form', to: 'route' })
    expect(wizard.getState().current).toBe('yes')
    wizard.dispose()
  })
})
