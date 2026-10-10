/**
 * (a) view → task → final with the REAL machine: sync-commit guarantee,
 * NavResult ok / rejected (validation via a guard boundary, guards, no-history),
 * back(), go(), dynamic next, dispatch mapping.
 */

import { describe, expect, it } from 'vitest'
import { final, flow, guard, task, view } from '../../helpers/fixtures'
import { e2e } from './harness'

const happy = () =>
  flow({
    name: 'happy',
    start: 'form',
    steps: {
      form: view({
        input: guard(
          (v) => typeof v === 'object' && v !== null && typeof (v as any).name === 'string',
          'name is required',
        ),
        next: 'work',
      }),
      work: task({
        run: ({ input, steps }) => ({
          greeting: `hello ${(steps.form!.output as any).name}`,
          sawInput: input,
        }),
        next: 'end',
      }),
      end: final({ output: ({ steps }) => steps.work!.output }),
    },
  })

describe('e2e nav: view → task → final (all sync)', () => {
  it('start enters the view through the cursor rule; the state is committed before the promise is awaited', async () => {
    const t = e2e(happy())
    const p = t.wizard.start()
    // Sync-commit: already there.
    expect(t.wizard.getState().current).toBe('form')
    expect(t.wizard.getState().status).toBe('waiting')
    // The cursor rule enters the only ready view through a (hookless) transaction.
    expect(t.types().slice(0, 2)).toEqual(['flow.started', 'step.arrived'])
    expect(t.types().slice(-2)).toEqual(['step.entered', 'transition.committed'])
    expect(t.of('transition.committed')[0]).toMatchObject({
      from: null,
      to: 'form',
      cause: 'start',
    })
    expect(await p).toEqual({ ok: true, seq: t.wizard.getState().seq })
    expect(t.states).toHaveLength(1)
  })

  it('next() with a failing input boundary → { ok:false, reason:validation, issues } and the cursor stays', async () => {
    const t = e2e(happy())
    await t.wizard.start()
    t.clear()
    const r = await t.wizard.next()
    expect(r).toMatchObject({
      ok: false,
      reason: 'validation',
      code: 'INVALID_INPUT',
      step: 'form',
      issues: [{ message: 'name is required' }],
    })
    expect(t.types()).toEqual([
      'transition.started',
      'transition.phase',
      'step.validationFailed',
      'transition.rejected',
    ])
    expect(t.wizard.getState().current).toBe('form')
    expect(t.rec('form').issues).toEqual([{ message: 'name is required' }])
    expect(t.wizard.getState().nav.phase).toBe('idle')
    // validate() agrees, without producing events.
    const before = t.events.length
    expect(await t.wizard.validate('form')).toEqual([{ message: 'name is required' }])
    expect(t.events.length).toBe(before)
  })

  it('setInput + next() runs the whole pipeline synchronously through the task to the final step', async () => {
    const t = e2e(happy())
    await t.wizard.start()
    await t.wizard.setInput('form', { name: 'ada' })
    expect(t.rec('form').issues).toBeUndefined()
    t.clear()
    const p = t.wizard.next()
    // Everything (parse, exit, task run, auto-advance, final output) is sync → done before await.
    expect(t.wizard.getState().status).toBe('done')
    expect(t.wizard.getState().output).toEqual({ greeting: 'hello ada', sawInput: undefined })
    const r = await p
    expect(r).toMatchObject({ ok: true, from: 'form', to: 'work' })
    expect(t.types()).toEqual([
      'transition.started',
      'transition.phase', // parsingInput
      'step.validated',
      'transition.phase', // validating
      'transition.phase', // canExit
      'transition.phase', // resolvingTarget
      'transition.phase', // canEnter
      'transition.phase', // exiting
      'transition.phase', // entering
      'step.exited',
      'step.arrived',
      'transition.committed',
      'step.entered',
      'step.runStarted',
      'step.runSucceeded',
      'step.done',
      'transition.started', // auto
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'transition.phase',
      'step.arrived',
      'transition.committed',
      'step.entered',
      'step.done',
      'flow.done',
    ])
    expect(t.rec('form')).toMatchObject({ status: 'done', output: { name: 'ada' } })
    expect(t.rec('work')).toMatchObject({
      status: 'done',
      attempt: 1,
      runId: 1,
      output: { greeting: 'hello ada', sawInput: undefined },
    })
    expect(t.rec('end').status).toBe('done')
    // Terminal: further commands are rejected as values, never thrown.
    expect(await t.wizard.next()).toMatchObject({
      ok: false,
      reason: 'flow-terminal',
      code: 'FLOW_TERMINAL',
    })
    expect(await t.wizard.setInput('form', {})).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    // The batches: start(1) + setInput(1) + next chain (all in one drain: 3 batches).
    expect(t.wizard.log().at(-1)?.seq).toBe(t.wizard.getState().seq)
  })

  it('reports guards, no-history, not-a-view and nav-busy as typed rejections', async () => {
    let allowExit = false
    let allowEnter = true
    let release: (() => void) | undefined
    const def = flow({
      name: 'guards',
      start: 'a',
      steps: {
        a: view({ canExit: () => allowExit, next: 'b' }),
        b: view({ canEnter: () => allowEnter, next: 'c' }),
        c: view({ canExit: () => new Promise<boolean>((r) => (release = () => r(true))) }),
      },
    })
    const t = e2e(def)
    await t.wizard.start()
    expect(await t.wizard.back()).toMatchObject({
      ok: false,
      reason: 'no-history',
      code: 'NO_HISTORY',
    })
    expect(await t.wizard.next()).toMatchObject({
      ok: false,
      reason: 'guard-canExit',
      code: 'GUARD_BLOCKED',
      step: 'a',
    })
    expect(t.rec('a').guards.canExit).toMatchObject({ ok: false })
    allowExit = true
    allowEnter = false
    expect(await t.wizard.next()).toMatchObject({
      ok: false,
      reason: 'guard-canEnter',
      code: 'GUARD_BLOCKED',
      step: 'b',
    })
    expect(t.wizard.getState().current).toBe('a')
    allowEnter = true
    expect(await t.wizard.next()).toMatchObject({ ok: true, from: 'a', to: 'b' })
    expect(await t.wizard.go('nope')).toMatchObject({
      ok: false,
      reason: 'not-a-view',
      code: 'NOT_A_VIEW',
    })
    expect(await t.wizard.go('c')).toMatchObject({
      ok: false,
      reason: 'not-reachable',
      code: 'NOT_REACHABLE',
      step: 'c',
    })
    // back(): previous view via history; canEnter on `a` (none) — no parse/validate/canExit on `b`.
    expect(await t.wizard.back()).toMatchObject({ ok: true, from: 'b', to: 'a' })
    expect(t.wizard.getState().history).toEqual(['a'])
    expect(t.rec('b').status).toBe('idle')
    // Forward again to b then to c; c has an async canExit → nav-busy while pending.
    await t.wizard.next()
    await t.wizard.next()
    const pending = t.wizard.next()
    expect(t.wizard.getState().nav.phase).toBe('canExit')
    expect(await t.wizard.next()).toMatchObject({ ok: false, reason: 'nav-busy', code: 'NAV_BUSY' })
    expect(await t.wizard.setInput('c', { x: 1 })).toMatchObject({ ok: false, code: 'NAV_BUSY' })
    release?.()
    // canExit passed but c has no `next` → no-target.
    expect(await pending).toMatchObject({ ok: false, reason: 'no-target', code: 'NO_TARGET' })
    expect(t.wizard.getState().nav.phase).toBe('idle')
  })

  it('dynamic next + go() to a previously visited view; dispatch() maps nav results', async () => {
    const def = flow({
      name: 'dyn',
      start: 'a',
      steps: {
        a: view({ dynamicNext: ({ context }) => ((context as any).vip ? 'vip' : 'std') }),
        std: view({ next: 'end' }),
        vip: view({ next: 'end' }),
        end: final(),
      },
    })
    const t = e2e(def, { context: { vip: true } })
    await t.wizard.start()
    expect(await t.wizard.dispatch({ type: 'next' })).toEqual({
      ok: true,
      seq: t.wizard.getState().seq,
    })
    expect(t.wizard.getState().current).toBe('vip')
    expect(await t.wizard.go('a')).toMatchObject({ ok: true, from: 'vip', to: 'a' })
    expect(t.wizard.getState().history).toEqual(['a', 'vip', 'a'])
    expect(await t.wizard.dispatch({ type: 'go', step: 'std' })).toMatchObject({
      ok: false,
      code: 'NOT_REACHABLE',
    })
  })
})
