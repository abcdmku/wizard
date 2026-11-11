/**
 * Nested flow adapters map context and dependencies before child creation. Each value
 * crosses its child boundary once; dependencies are mapped again when a child resumes.
 * Mapper and boundary failures belong to the child step.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { createSequentialIds } from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMemoryStore } from '../../src/persistence/memory-store'
import type { StepState } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

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
    const seen: { context: unknown; deps: unknown }[] = []
    const childFlow = defineWizard(
      {
        name: 'child',
        // A string input becomes a number. Parsing that number again would fail.
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
      },
      ({ step, steps }) =>
        steps({
          work: step({
            run: ({ context, deps }) => {
              seen.push({ context, deps })
              return context.n * 2
            },
            next: 'end',
          }),
          end: step({ run: ({ context }) => context.n }),
        }),
    )
    // A child without a deps boundary receives the parent's deps object unchanged.
    const plainSeen: unknown[] = []
    const plainFlow = defineWizard(
      { name: 'plain', context: boundary.trusted<{ ok: boolean }>() },
      ({ step, steps }) =>
        steps({
          look: step({
            run: ({ deps }) => {
              plainSeen.push(deps)
              return 1
            },
            next: 'end',
          }),
          end: step({ next: null }),
        }),
    )
    const parentFlow = defineWizard(
      {
        name: 'parent',
        context: z.object({ raw: z.string() }),
        deps: boundary.trusted<ParentDeps>(),
      },
      ({ step, flow, steps }) => {
        const sub = flow(childFlow, {
          context: ({ context }) => ({ n: context.raw }),
          deps: ({ deps }) => ({ svc: deps.svc, parsed: false }),
          next: 'fallback',
        })
        const fallback = flow(plainFlow, { context: () => ({ ok: true }), next: 'done' })
        return steps(
          {
            sub,
            fallback,
            done: step({ needs: { sub, fallback }, run: ({ needs }) => needs.sub }),
          },
          { start: 'sub' },
        )
      },
    )
    const parentDeps: ParentDeps = { svc: { name: 'inventory' }, extra: 1 }
    const run = parentFlow.create(
      { raw: '21' },
      {
        deps: parentDeps,
        scheduler: createTestScheduler({ now: 1_000 }),
        ids: createSequentialIds(),
        instanceId: 'p-1',
      },
    )
    return {
      run,
      parentDeps,
      seen,
      plainSeen,
      parses: () => ({ context: contextParses, deps: depsParses }),
    }
  }

  it('parses the mapped context once (transform), maps + parses deps once, passes parent deps through unchanged', async () => {
    const t = setup()
    await t.run.start()
    await tick()
    await tick()
    expect(t.parses()).toEqual({ context: 1, deps: 1 })
    expect(t.seen).toEqual([
      { context: { n: 21 }, deps: { svc: { name: 'inventory' }, parsed: true } },
    ])
    expect(t.run.getState().steps.sub.output).toBe(21)
    expect(t.seen[0]?.deps).not.toBe(t.parentDeps)
    expect(t.plainSeen).toHaveLength(1)
    expect(t.plainSeen[0]).toBe(t.parentDeps)
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toBe(21)
    t.run.dispose()
  })

  it('a throwing deps mapper / a rejecting deps boundary fails the flow step (kind child), context untouched', async () => {
    const childFlow = defineWizard(
      {
        name: 'child',
        context: boundary.trusted<{ n: number }>(),
        deps: boundary.guard(
          (v): v is { svc: string } => typeof v === 'object' && v !== null && 'svc' in v,
        ),
      },
      ({ step, steps }) => steps({ end: step({ next: null }) }),
    )
    const throwing = defineWizard(
      { name: 'parent', context: boundary.trusted<{ n: number }>() },
      ({ step, flow, steps }) =>
        steps({
          f: flow(childFlow, {
            context: ({ context }) => ({ n: context.n }),
            deps: () => {
              throw new Error('no deps for you')
            },
            next: 'e',
          }),
          e: step({ next: null }),
        }),
    )
    const w1 = throwing.create({ n: 1 })
    await w1.start()
    expect(w1.getState().steps.f).toMatchObject({
      status: 'failed',
      error: { kind: 'child', message: 'no deps for you' },
    })
    expect(w1.getState().status).toBe('halted')
    expect(w1.getState().context).toEqual({ n: 1 })
    w1.dispose()

    const rejecting = defineWizard(
      { name: 'parent', context: boundary.trusted<{ n: number }>() },
      ({ step, flow, steps }) =>
        steps({
          f: flow(childFlow, {
            context: ({ context }) => ({ n: context.n }),
            deps: () => ({ nope: 1 }) as never,
            next: 'e',
          }),
          e: step({ next: null }),
        }),
    )
    const w2 = rejecting.create({ n: 1 })
    await w2.start()
    expect(w2.getState().steps.f).toMatchObject({
      status: 'failed',
      error: { kind: 'child', code: 'BOUNDARY_REJECTED' },
    })
    expect(w2.getState().steps.f.error?.message).toContain("deps of child flow 'child' rejected")
    expect(w2.getState().context).toEqual({ n: 1 })
    w2.dispose()
  })

  it('re-runs the deps mapper on restore (deps are never persisted); the child keeps its parsed deps', async () => {
    const store = createMemoryStore()
    const depsSeen: unknown[] = []
    const childFlow = defineWizard(
      {
        name: 'child',
        context: boundary.trusted<{ n: number }>(),
        deps: boundary.parse((v) => ({ ...(v as { svc: string }), parsed: true })),
      },
      ({ step, view, steps }) =>
        steps({
          wait: view({
            enter: ({ deps }) => depsSeen.push(deps),
            exit: ({ deps }) => depsSeen.push(deps),
            next: 'end',
          }),
          end: step({ next: null }),
        }),
    )
    let mapperCalls = 0
    const parentFlow = defineWizard(
      {
        name: 'parent',
        context: boundary.trusted<{ n: number }>(),
        deps: boundary.trusted<{ svc: string }>(),
      },
      ({ step, flow, steps }) =>
        steps({
          f: flow(childFlow, {
            context: ({ context }) => ({ n: context.n }),
            deps: ({ deps }) => {
              mapperCalls += 1
              return { svc: deps.svc, parsed: true }
            },
            next: 'e',
          }),
          e: step({ next: null }),
        }),
    )
    const first = parentFlow.create({ n: 1 }, { deps: { svc: 'a' }, store, key: 'k' })
    await first.start()
    expect(mapperCalls).toBe(1)
    expect(depsSeen).toEqual([{ svc: 'a', parsed: true }])
    expect(first.child('f').getState().current).toBe('wait')
    await first.save()
    first.dispose()

    const resumed = parentFlow.resume(await store.get('k'), { deps: { svc: 'b' } })
    expect(mapperCalls).toBe(2)
    depsSeen.length = 0
    expect(
      await resumed.dispatch({ type: 'child', path: ['f'], command: { type: 'next' } }),
    ).toMatchObject({ ok: true })
    expect(depsSeen).toEqual([{ svc: 'b', parsed: true }])
    expect(resumed.child('f').getState().status).toBe('done')
    resumed.dispose()
  })
})

describe('routing output and the user transaction of next()', () => {
  const flow = defineWizard(
    { name: 'routes', context: boundary.trusted<{ n: number }>() },
    ({ step, view, steps }) =>
      steps(
        {
          form: view({ next: 'route' }),
          route: step({
            next: ({ context }) => (context.n > 0 ? 'yes' : ['yes', 'no']),
            targets: ['yes', 'no'],
          }),
          yes: view({ next: 'end' }),
          no: view({ next: 'end' }),
          end: step({ next: null }),
        },
        { start: 'form' },
      ),
  )

  it('StepState<F, routing>.output is undefined at runtime too', async () => {
    const run = flow.create({ n: 1 })
    await run.start()
    await run.next()
    const route: StepState<typeof flow, 'route'> = run.getState().steps.route
    const output: undefined = route.output
    expect(output).toBeUndefined()
    expect(route.status).toBe('done')
    run.dispose()
  })

  it('next() reports the user transaction when a cursor-rule auto transition commits in the same batch', async () => {
    const run = flow.create({ n: 1 })
    await run.start()
    const result = await run.next()
    expect(result).toMatchObject({ ok: true, from: 'form', to: 'route' })
    expect(run.getState().current).toBe('yes')
    run.dispose()
  })
})
