import { createWizard, type WizardEvent } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { type Deps, onboarding } from './onboarding'

/** In-memory fake for the out-of-domain CRM: records every call, answers synchronously. */
function fakeCrm() {
  const calls: Parameters<Deps['crm']['upsert']>[0][] = []
  const deps: Deps = {
    crm: {
      upsert: (contact) => {
        calls.push(contact)
        return { id: `crm_${calls.length}` }
      },
    },
  }
  return { deps, calls }
}

/** Event types worth reading in a trace (the machine also emits `transition.phase` etc.). */
const INTERESTING = new Set<WizardEvent['type']>([
  'flow.started',
  'step.entered',
  'step.validationFailed',
  'transition.rejected',
  'input.changed',
  'step.validated',
  'context.changed',
  'step.exited',
  'transition.committed',
  'step.runStarted',
  'step.runSucceeded',
  'step.done',
  'flow.done',
])
const trace = (events: readonly WizardEvent[]) =>
  events
    .filter((e) => INTERESTING.has(e.type))
    .map((e) => ('step' in e && typeof e.step === 'string' ? `${e.type}:${e.step}` : e.type))

describe('01 happy path: view → task → final', () => {
  it('rejects an invalid draft as a value, then runs the whole chain synchronously', async () => {
    const { deps, calls } = fakeCrm()
    const wizard = createWizard(onboarding, { context: { email: 'ada@example.com' }, deps })
    const events: WizardEvent<typeof onboarding>[] = []
    wizard.observe((e) => events.push(e))

    // The context went through its boundary at the door (parsed, typed).
    expect(wizard.getState().status).toBe('idle')
    expect(wizard.getState().context).toEqual({ email: 'ada@example.com' })
    expect(wizard.getState().current).toBeNull()

    // start(): the cursor enters the first view.
    expect(await wizard.start()).toMatchObject({ ok: true })
    expect(wizard.getState().current).toBe('profile')
    expect(wizard.getState().status).toBe('waiting')
    expect(wizard.explain('save').reasons).toEqual(['not-activated'])

    // next() with an empty draft: the input boundary rejects it — a result, not a throw.
    const rejected = await wizard.next()
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'validation',
      code: 'INVALID_INPUT',
      step: 'profile',
    })
    if (rejected.ok || rejected.reason !== 'validation') throw new Error('unreachable')
    expect(rejected.issues).toHaveLength(1) // no draft at all yet: "expected object"
    expect(wizard.getState().steps.profile.issues).toEqual(rejected.issues)
    expect(wizard.getState().current).toBe('profile') // the cursor did not move
    expect(calls).toEqual([]) // and the task never ran

    // Drafts are shallow-merged; validate() is a pure query over the current draft.
    expect(await wizard.setInput('profile', { company: 'Acme' })).toMatchObject({ ok: true })
    expect((await wizard.validate('profile')).map((i) => i.path)).toEqual([['role']])
    expect(await wizard.setInput('profile', { role: 'engineer' })).toMatchObject({ ok: true })
    expect(await wizard.validate('profile')).toEqual([])
    expect(wizard.getState().steps.profile.input).toEqual({ company: 'Acme', role: 'engineer' })

    // Sync-commit guarantee: every hook here is synchronous (the CRM fake answers directly),
    // so the parse → exit → task → final chain is committed BEFORE the promise is awaited.
    const pending = wizard.next()
    expect(wizard.getState().status).toBe('done')
    expect(await pending).toMatchObject({ ok: true, from: 'profile', to: 'save' })

    const state = wizard.getState()
    expect(state.steps.profile).toMatchObject({
      status: 'done',
      output: { company: 'Acme', role: 'engineer' },
    })
    expect(state.context).toEqual({ email: 'ada@example.com', company: 'Acme', role: 'engineer' })
    expect(state.steps.save).toMatchObject({ status: 'done', output: { id: 'crm_1' } })
    expect(state.output).toBe('ada@example.com @ Acme')
    expect(calls).toEqual([{ email: 'ada@example.com', company: 'Acme', role: 'engineer' }])

    // The event trace tells the whole story (observe() and log() see the same events).
    expect(trace(events)).toEqual([
      'flow.started',
      'step.entered:profile',
      'transition.committed',
      'step.validationFailed:profile',
      'transition.rejected:profile',
      'input.changed:profile',
      'input.changed:profile',
      'step.validated:profile',
      'context.changed',
      'step.exited:profile',
      'transition.committed',
      'step.entered:save',
      'step.runStarted:save',
      'step.runSucceeded:save',
      'step.done:save',
      'transition.committed',
      'step.entered:done',
      'step.done:done',
      'flow.done',
    ])
    expect(trace(wizard.log())).toEqual(trace(events))

    // Terminal: further commands are rejected as values.
    expect(await wizard.next()).toMatchObject({ ok: false, code: 'FLOW_TERMINAL' })
    wizard.dispose()
  })

  it('getSnapshot() is a versioned, JSON-safe envelope of the typed state', async () => {
    const { deps } = fakeCrm()
    const wizard = createWizard(onboarding, {
      context: { email: 'grace@example.com' },
      deps,
      instanceId: 'onboarding-1',
    })
    await wizard.start()
    await wizard.setInput('profile', { company: 'Navy', role: 'founder' })
    const snapshot = wizard.getSnapshot()
    expect(snapshot).toMatchObject({
      v: 1,
      flow: { name: 'onboarding', version: 1 },
      instanceId: 'onboarding-1',
      epoch: 0,
      seq: wizard.getState().seq,
      children: {},
    })
    expect(snapshot.state.current).toBe('profile')
    expect(snapshot.state.steps.profile.input).toEqual({ company: 'Navy', role: 'founder' })
    // What a store persists is exactly what a JSON round trip preserves.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    // Cached per state: the same object until the state changes.
    expect(wizard.getSnapshot()).toBe(snapshot)
    await wizard.next()
    expect(wizard.getSnapshot()).not.toBe(snapshot)
    expect(wizard.getSnapshot().state.status).toBe('done')
    wizard.dispose()
  })
})
