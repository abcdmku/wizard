import { expect, it } from 'vitest'
import { type Frame, record } from './record'
import { scenarios } from './scenarios'

const statuses = (frame: Frame | undefined) =>
  Object.fromEntries(Object.entries(frame?.steps ?? {}).map(([key, step]) => [key, step.status]))

const last = async (name: string, index = 0) => {
  const scenario = scenarios[name]?.[index]
  if (!scenario) throw new Error(`no scenario ${name}[${index}]`)
  const { frames } = await record(scenario)
  return { frames, end: frames.at(-1) }
}

it('every scenario starts with no step started and ends with a settled run', async () => {
  for (const [name, variants] of Object.entries(scenarios)) {
    for (const scenario of variants) {
      const { frames } = await record(scenario)
      const label = `${name}: ${scenario.label}`
      expect(frames.length, label).toBeGreaterThan(2)
      expect(new Set(Object.values(statuses(frames[0]))), label).toEqual(new Set(['idle']))
      expect(['done', 'failed'], label).toContain(frames.at(-1)?.run)
      for (const frame of frames) expect(frame.note, label).not.toBe('')
    }
  }
})

it('needs: shows both producers running before the step that needs them', async () => {
  const { frames } = await last('needs')
  const together = frames.find(
    (frame) => frame.steps.profile?.status === 'active' && frame.steps.orders?.status === 'active',
  )
  expect(together?.steps.summary?.status).toBe('idle')
  expect(statuses(frames.at(-1))).toEqual({ profile: 'done', orders: 'done', summary: 'done' })
})

it('forms: keeps the run on the view after an invalid draft', async () => {
  const { frames } = await last('forms')
  const refused = frames.find((frame) => frame.returned?.includes("'INVALID_INPUT'"))
  expect(refused?.steps.contact?.status).toBe('active')
  expect(frames.at(-1)?.returned).toContain("output: 'Welcome, ada@example.com'")
})

it('branch: skips the branch that was not chosen', async () => {
  expect(statuses((await last('branch', 0)).end)).toMatchObject({ standard: 'skipped' })
  expect(statuses((await last('branch', 1)).end)).toMatchObject({ express: 'skipped' })
})

it('wait: a timeout skips the wait and still runs the step with an optional need', async () => {
  const { frames, end } = await last('wait', 1)
  expect(statuses(end)).toEqual({ decision: 'skipped', close: 'done' })
  expect(frames.at(-1)?.returned).toContain('Expired after 48 hours')
})

it('failures: shows retrying, a halt, a fallback and an undo', async () => {
  const retry = await last('retry', 0)
  expect(retry.frames.some((frame) => frame.steps.save?.phase === 'retrying')).toBe(true)

  const halted = await last('retry', 1)
  expect(halted.frames.some((frame) => frame.run === 'halted')).toBe(true)
  expect(halted.end?.run).toBe('done')

  expect(statuses((await last('fallback')).end)).toEqual({
    live: 'skipped',
    list: 'done',
    quote: 'done',
  })

  const undo = await last('compensate')
  expect(undo.frames.some((frame) => frame.steps.flight?.status === 'compensating')).toBe(true)
  expect(undo.end?.run).toBe('failed')
  expect(undo.end?.steps.flight?.status).toBe('compensated')
})

it('save and resume: the resumed run starts where the first one stopped', async () => {
  const { frames } = await last('save-resume')
  const resumed = frames.find((frame) => frame.call.includes('signup.resume'))
  expect(resumed?.steps.contact?.status).toBe('active')
  expect(frames.at(-1)?.run).toBe('done')
})

it('children: records the steps of the child run', async () => {
  const { frames, end } = await last('children')
  expect(frames.some((frame) => frame.steps['shipping/street']?.status === 'active')).toBe(true)
  expect(end?.steps.confirm?.status).toBe('done')
})

it('outside: records the form, the service calls and the event of a refund', async () => {
  const { frames, end } = await last('refund')
  const kinds = (frame: Frame | undefined) =>
    (frame?.outside ?? []).map((card) =>
      card.kind === 'form'
        ? `form ${card.step} ${card.state}`
        : `${card.kind} ${card.name} ${card.state}`,
    )
  const loading = frames.find((frame) => frame.call === 'await run.start()')
  expect(kinds(loading)).toEqual(['form request open', 'call orders.find pending'])
  expect(kinds(end)).toEqual([
    'form request submitted',
    'call orders.find returned',
    'event refund.approved delivered',
    'call payments.refund returned',
  ])
  const form = end?.outside.find((card) => card.kind === 'form')
  expect(form).toMatchObject({ fields: { amount: '900', reason: 'never arrived' } })
})

it('outside: shows a refused draft, a refused event and each attempt of a retried call', async () => {
  const forms = await last('forms')
  const refused = forms.frames.find((frame) => frame.returned?.includes("'INVALID_INPUT'"))
  expect(refused?.outside).toMatchObject([
    { kind: 'form', state: 'invalid', issue: 'Invalid email address' },
  ])

  const wait = await last('wait', 0)
  expect(wait.end?.outside.map((card) => card.kind === 'event' && card.state)).toEqual([
    'rejected',
    'delivered',
  ])

  const retry = await last('retry', 0)
  const secondAttempt = retry.frames.filter((frame) => frame.steps.save?.phase === 'running')[1]
  expect(secondAttempt?.outside.map((card) => card.kind === 'call' && card.state)).toEqual([
    'threw',
    'pending',
  ])
  expect(retry.end?.outside.map((card) => card.kind === 'call' && card.state)).toEqual([
    'threw',
    'threw',
    'returned',
  ])
})
