/**
 * `SKIPPED_NEED`: a timeout or fallback target with a plain need on the step that starts it.
 * That step is skipped when its timeout fires or its fallback takes over, so the target is
 * skipped too. The run tests show the behaviour the warning describes.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { inspect } from '../../src/inspect/graph'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineWizard } from '../../src/wizard/define-wizard'

const header = {
  name: 'reply',
  context: z.object({}),
  events: { answered: z.object({ text: z.string() }) },
}

/** The dead shape: `giveUp` is the timeout target of `reply` and needs its output. */
const dead = defineWizard(header, ({ step, steps }) => {
  const reply = step({
    waitFor: { answered: ({ payload }) => ({ done: payload.text }) },
    timeout: { after: '1h', next: 'giveUp' },
  })
  const giveUp = step({ needs: { reply }, run: ({ needs }) => `no reply: ${needs.reply}` })
  return steps({ reply, giveUp })
})

/** Correct: the need is optional, so the timeout target runs and reads `undefined`. */
const optional = defineWizard(header, ({ step, steps }) => {
  const reply = step({
    waitFor: { answered: ({ payload }) => ({ done: payload.text }) },
    timeout: { after: '1h', next: 'giveUp' },
  })
  const giveUp = step({
    needs: { reply: { optional: reply } },
    run: ({ needs }) => needs.reply ?? 'no reply',
  })
  return steps({ reply, giveUp })
})

/** Correct: the timeout target does not need the wait. */
const independent = defineWizard(header, ({ step, steps }) => {
  const reply = step({
    waitFor: { answered: ({ payload }) => ({ done: payload.text }) },
    timeout: { after: '1h', next: 'giveUp' },
  })
  const answered = step({ needs: { reply }, run: ({ needs }) => needs.reply })
  const giveUp = step({ run: () => 'no reply' })
  return steps({ reply, answered, giveUp })
})

describe('SKIPPED_NEED', () => {
  it('warns when a timeout target has a plain need on the wait that times out', () => {
    expect(inspect(dead).warnings).toEqual([
      {
        code: 'SKIPPED_NEED',
        message:
          "step 'giveUp' is the timeout target of 'reply' and needs its output, but 'reply' is skipped when it times out, so 'giveUp' is skipped too; declare the need as { optional: reply } and handle undefined, or remove it",
        step: 'giveUp',
        path: [],
      },
    ])
  })

  it('the warned shape is skipped when the timeout fires', async () => {
    const scheduler = createTestScheduler()
    const run = dead.create({}, { scheduler })
    await run.start()
    scheduler.advance(3_600_000)
    await run.whenIdle()
    const { steps } = run.getState()
    expect(steps.reply).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(steps.giveUp).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
    run.dispose()
  })

  it('does not warn for an optional need, and the timeout target runs', async () => {
    expect(inspect(optional).warnings).toEqual([])
    const scheduler = createTestScheduler()
    const run = optional.create({}, { scheduler })
    await run.start()
    scheduler.advance(3_600_000)
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'no reply' })
    run.dispose()
  })

  it('does not warn for a timeout target that does not need the wait', () => {
    expect(inspect(independent).warnings.filter((w) => w.code === 'SKIPPED_NEED')).toEqual([])
  })

  it('warns when a fallback target has a plain need on the step that fell back', async () => {
    const wizard = defineWizard({ name: 'charge', context: z.object({}) }, ({ step, steps }) => {
      const charge = step({
        run: (): { paymentId: string } => {
          throw new Error('declined')
        },
        fallback: 'recover',
      })
      const recover = step({ needs: { charge }, run: ({ needs }) => needs.charge.paymentId })
      return steps({ charge, recover })
    })
    expect(inspect(wizard).warnings).toEqual([
      {
        code: 'SKIPPED_NEED',
        message:
          "step 'recover' is the fallback of 'charge' and needs its output, but 'charge' is skipped when it falls back, so 'recover' is skipped too; declare the need as { optional: charge } and handle undefined, or remove it",
        step: 'recover',
        path: [],
      },
    ])
    const run = wizard.create({})
    await run.start()
    await run.whenIdle()
    const { steps: state } = run.getState()
    expect(state.charge).toMatchObject({ status: 'skipped', skipReason: 'fallback' })
    expect(state.recover).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
    run.dispose()
  })

  it('warns for a need under another alias and for an `any` need with no other producer', () => {
    const wizard = defineWizard(header, ({ step, steps }) => {
      const reply = step({
        waitFor: { answered: ({ payload }) => ({ done: payload.text }) },
        timeout: { after: '1h', next: 'giveUp' },
      })
      const giveUp = step({ needs: { answer: reply }, run: ({ needs }) => needs.answer })
      const charge = step({ run: () => 'paid', fallback: 'recover' })
      const recover = step({ needs: { payment: { any: [charge] } }, run: () => 'recovered' })
      return steps({ reply, giveUp, charge, recover }, { start: ['reply', 'charge'] })
    })
    expect(
      inspect(wizard).warnings.flatMap((w) => (w.code === 'SKIPPED_NEED' ? [w.message] : [])),
    ).toEqual([
      "step 'giveUp' is the timeout target of 'reply' and needs its output, but 'reply' is skipped when it times out, so 'giveUp' is skipped too; declare the need as { optional: reply } and handle undefined, or remove it",
      "step 'recover' is the fallback of 'charge' and needs its output, but 'charge' is skipped when it falls back, so 'recover' is skipped too; declare the need as { optional: charge } and handle undefined, or remove it",
    ])
  })

  it('does not warn for an `any` need that another step can meet', () => {
    const wizard = defineWizard(header, ({ step, steps }) => {
      const reply = step({
        waitFor: { answered: ({ payload }) => ({ done: payload.text }) },
        timeout: { after: '1h', next: 'giveUp' },
      })
      const guess = step({ run: () => 'guess' })
      const giveUp = step({
        needs: { text: { any: [reply, guess] } },
        run: ({ needs }) => needs.text,
      })
      return steps({ reply, guess, giveUp }, { start: ['reply', 'guess'] })
    })
    expect(inspect(wizard).warnings.filter((w) => w.code === 'SKIPPED_NEED')).toEqual([])
  })

  it('reports the shape inside a child wizard with the path of the child step', () => {
    const outer = defineWizard({ name: 'outer', context: z.object({}) }, ({ child, steps }) =>
      steps({ ask: child(dead, { context: () => ({}) }) }),
    )
    expect(inspect(outer).warnings.map((w) => [w.code, w.step, w.path])).toEqual([
      ['SKIPPED_NEED', 'giveUp', ['ask']],
    ])
  })
})
