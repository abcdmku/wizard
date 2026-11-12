import { expect, it } from 'vitest'
import { createLive, type Live, type LiveState } from './live'
import { liveSpecs } from './live-specs'

/** Valid drafts for the examples whose first draft is wrong on purpose. */
const VALID: Readonly<Record<string, Record<string, unknown>>> = {
  contact: { email: 'ada@example.com' },
}

const live = (name: string, index = 0): Live => {
  const spec = liveSpecs[name]?.[index]
  if (!spec) throw new Error(`no example ${name}[${index}]`)
  return createLive(spec)
}

const statuses = (state: LiveState) =>
  Object.fromEntries(Object.entries(state.steps).map(([key, step]) => [key, step.status]))

/** Do what a reader does next: start, fill a form, send an event, answer a call, move time. */
async function step(run: Live, answer: 'returned' | 'threw' = 'returned'): Promise<boolean> {
  const state = run.getState()
  if (!state.started) await run.start()
  else if (state.forms[0])
    await run.submit(state.forms[0], { ...state.forms[0].draft, ...VALID[state.forms[0].id] })
  else if (state.events[0]) await run.send(state.events[0], state.events[0].payload)
  else if (state.calls.find((call) => call.state === 'pending')) {
    const call = state.calls.find((item) => item.state === 'pending')
    if (call) await run.answer(call, call.fail ? answer : 'returned')
  } else if (state.halted) await run.retry(state.halted.step)
  else if (state.nextTimer !== undefined) await run.advance()
  else return false
  return true
}

async function finish(run: Live): Promise<LiveState> {
  for (let turn = 0; turn < 30 && (await step(run)); turn += 1) {}
  await new Promise((resolve) => setTimeout(resolve, 0))
  return run.getState()
}

it('every example can be driven to the end by a reader', async () => {
  for (const [name, specs] of Object.entries(liveSpecs)) {
    for (const [index, spec] of specs.entries()) {
      const run = live(name, index)
      const label = `${name}: ${spec.label}`
      expect(run.getState().log[0]?.call, label).toBe(spec.call)
      expect(new Set(Object.values(statuses(run.getState()))), label).toEqual(new Set(['idle']))
      const end = await finish(run)
      expect(end.run, label).toBe('done')
      expect(end.log.at(-1)?.returned, label).toContain("status: 'done'")
      run.dispose()
    }
  }
})

it('forms: an invalid draft keeps the run on the view and says why', async () => {
  const run = live('forms')
  await run.start()
  const form = run.getState().forms[0]
  if (!form) throw new Error('no form')
  await run.submit(form, { email: 'not-an-email' })
  const refused = run.getState()
  expect(refused.forms[0]?.issue).toContain('email')
  expect(refused.steps.contact?.status).toBe('active')
  expect(refused.log.at(-1)?.returned).toContain('INVALID_INPUT')
  run.dispose()
})

it('wait: moving time past the deadline skips the wait and still runs close', async () => {
  const run = live('wait')
  await run.start()
  expect(run.getState().nextTimer).toBe(48 * 60 * 60 * 1000)
  await run.advance()
  expect(statuses(run.getState())).toEqual({ decision: 'skipped', close: 'done' })
  expect(run.getState().log.some((entry) => entry.call === '// 48 hours pass')).toBe(true)
  run.dispose()
})

it('retry: failed calls retry after a wait, then halt, and run.retry starts again', async () => {
  const run = live('retry')
  await run.start()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const call = run.getState().calls.find((item) => item.state === 'pending')
    if (!call) throw new Error('no pending call')
    await run.answer(call, 'threw')
    if (attempt < 2) {
      expect(run.getState().steps.save?.phase).toBe('retrying')
      await run.advance()
    }
  }
  expect(run.getState().halted?.step).toBe('save')
  await run.retry('save')
  const end = await finish(run)
  expect(end.run).toBe('done')
  run.dispose()
})

it('fallback: a failed live price runs list instead', async () => {
  const run = live('fallback')
  await run.start()
  const call = run.getState().calls[0]
  if (!call) throw new Error('no call')
  await run.answer(call, 'threw')
  const end = await finish(run)
  expect(statuses(end)).toMatchObject({ live: 'skipped', list: 'done', quote: 'done' })
  run.dispose()
})

it('compensate: a full hotel cancels the flight and the run fails', async () => {
  const run = live('compensate')
  await run.start()
  const answer = async (name: string, outcome: 'returned' | 'threw') => {
    const call = run.getState().calls.find((item) => item.name === name && item.state === 'pending')
    if (!call) throw new Error(`no pending ${name}`)
    await run.answer(call, outcome)
  }
  await answer('flights.book', 'returned')
  await answer('hotels.book', 'threw')
  expect(run.getState().steps.flight?.status).toBe('compensating')
  await answer('flights.cancel', 'returned')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(run.getState().run).toBe('failed')
  expect(run.getState().steps.flight?.status).toBe('compensated')
  run.dispose()
})

it('save-resume: the draft survives a save, a dispose and a resume', async () => {
  const run = live('save-resume')
  await run.start()
  const form = run.getState().forms[0]
  if (!form) throw new Error('no form')
  expect(run.getState().canResume).toBe(true)
  await run.saveAndResume()
  const resumed = run.getState()
  expect(resumed.canResume).toBe(false)
  expect(resumed.log.at(-1)?.call).toContain('signup.resume')
  expect(resumed.forms[0]?.id).toBe('contact')
  expect((await finish(run)).run).toBe('done')
  run.dispose()
})

it('refund: a small refund skips the manager, a large one waits for the event', async () => {
  const small = live('refund')
  await small.start()
  const form = small.getState().forms[0]
  if (!form) throw new Error('no form')
  await small.submit(form, { amount: 40, reason: 'damaged' })
  expect(small.getState().steps.managerApproval?.status).toBe('skipped')
  expect((await finish(small)).run).toBe('done')
  small.dispose()

  const large = live('refund')
  await large.start()
  const request = large.getState().forms[0]
  if (!request) throw new Error('no form')
  await large.submit(request, { amount: 900, reason: 'never arrived' })
  expect(large.getState().events.map((event) => event.name)).toEqual(['refund.approved'])
  expect((await finish(large)).run).toBe('done')
  large.dispose()
})
