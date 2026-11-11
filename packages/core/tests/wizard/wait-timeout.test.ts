/**
 * A wait whose `timeout` deadline passes is skipped with reason `timeout`: `timeout.next` runs,
 * the wait's own `next` and `exit` do not, and steps that need the wait follow the rules of any
 * skipped producer.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'
import { replay } from '../../src/replay'
import { createTestScheduler } from '../../src/testing'

const HOUR = 60 * 60 * 1000
const events = { decided: z.object({ by: z.string() }) }

function approval(calls: string[]) {
  return defineWizard(
    { name: 'timed-approval', context: z.object({}), events, output: () => 'finished' },
    ({ step, steps }) => {
      const decision = step({
        waitFor: { decided: ({ payload }) => ({ done: payload.by }) },
        timeout: { after: '1h', next: 'expired' },
        next: 'approved',
        exit: ({ output }) => {
          calls.push(`exit:${output}`)
        },
      })
      const approved = step({ run: () => 'approved' })
      const notify = step({
        needs: { decision },
        run: ({ needs }) => {
          calls.push(`notify:${needs.decision}`)
          return needs.decision.toUpperCase()
        },
      })
      const summary = step({
        needs: { decision: { optional: decision } },
        run: ({ needs }) => needs.decision ?? 'nobody',
      })
      const expired = step({ run: () => 'expired' })
      return steps({ decision, approved, notify, summary, expired })
    },
  )
}

describe('wait timeout', () => {
  it('skips the wait, runs timeout.next, and skips a step that needs the wait', async () => {
    const calls: string[] = []
    const wizard = approval(calls)
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler: clock })
    await run.start()
    clock.advance(HOUR)
    expect(await run.awaitResult()).toMatchObject({ status: 'done' })

    const { steps } = run.getState()
    expect(steps.decision).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(steps.decision).not.toHaveProperty('output')
    expect(steps.decision).not.toHaveProperty('deadline')
    expect(steps.expired).toMatchObject({ status: 'done', output: 'expired' })
    expect(steps.approved).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(steps.notify).toMatchObject({ status: 'skipped', skipReason: 'needs-skipped' })
    expect(steps.summary).toMatchObject({ status: 'done', output: 'nobody' })
    expect(calls).toEqual([])
    expect(run.explain('decision').reasons).toContain('skipped:timeout')
    expect(run.getState().timers).toEqual({})
    expect(replay(wizard, run.log(), { context: {}, instanceId: run.id })).toEqual(run.getState())
    run.dispose()
  })

  it('completes with the payload, runs next and exit, and leaves timeout.next alone', async () => {
    const calls: string[] = []
    const clock = createTestScheduler({ now: 0 })
    const run = approval(calls).create({}, { scheduler: clock })
    await run.start()
    expect(await run.send('decided', { by: 'ada' })).toMatchObject({ ok: true })
    expect(await run.awaitResult()).toMatchObject({ status: 'done' })

    const { steps } = run.getState()
    expect(steps.decision).toMatchObject({ status: 'done', output: 'ada' })
    expect(steps.approved).toMatchObject({ status: 'done', output: 'approved' })
    expect(steps.notify).toMatchObject({ status: 'done', output: 'ADA' })
    expect(steps.summary).toMatchObject({ status: 'done', output: 'ada' })
    expect(steps.expired.status).toBe('idle')
    expect(calls).toEqual(['exit:ada', 'notify:ada'])
    expect(clock.pending()).toBe(0)
    run.dispose()
  })

  it('an `any` need takes the other producer, and is skipped once every producer is', async () => {
    const wizard = defineWizard(
      { name: 'any-timeout', context: z.object({ wait: z.string() }), events },
      ({ step, steps }) => {
        const manager = step({
          waitFor: { decided: ({ payload }) => ({ done: payload.by }) },
          timeout: { after: '1h', next: 'policy' },
        })
        const policy = step({
          waitFor: { decided: ({ payload }) => ({ done: `policy for ${payload.by}` }) },
          timeout: { after: '2h', next: 'closed' },
        })
        const pay = step({
          needs: { by: { any: [manager, policy] } },
          run: ({ needs }) => `paid, approved by ${needs.by}`,
        })
        const closed = step({ run: () => 'closed' })
        return steps({ manager, policy, pay, closed }, { start: 'manager' })
      },
    )
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({ wait: 'manager' }, { scheduler: clock })
    await run.start()
    clock.advance(HOUR)
    expect(run.getState().steps.manager).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(run.getState().steps.pay.status).toBe('idle')
    expect(await run.send('decided', { by: 'grace' })).toMatchObject({ ok: true })
    expect(await run.awaitResult()).toMatchObject({
      status: 'done',
      output: 'paid, approved by policy for grace',
    })
    run.dispose()

    const late = wizard.create({ wait: 'manager' }, { scheduler: clock })
    await late.start()
    clock.advance(3 * HOUR)
    await late.awaitResult()
    expect(late.getState().steps).toMatchObject({
      manager: { status: 'skipped', skipReason: 'timeout' },
      policy: { status: 'skipped', skipReason: 'timeout' },
      pay: { status: 'skipped', skipReason: 'needs-skipped' },
      closed: { status: 'done', output: 'closed' },
    })
    late.dispose()
  })

  it('skips a timeout target that has a plain need on the wait itself', async () => {
    const wizard = defineWizard(
      { name: 'self-need', context: z.object({}), events },
      ({ step, steps }) => {
        const reply = step({
          waitFor: { decided: ({ payload }) => ({ done: payload.by }) },
          timeout: { after: '1h', next: 'summary' },
        })
        const summary = step({ needs: { reply }, run: ({ needs }) => `by ${needs.reply}` })
        return steps({ reply, summary })
      },
    )
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler: clock })
    await run.start()
    clock.advance(HOUR)
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: undefined })
    expect(run.getState().steps.summary).toMatchObject({
      status: 'skipped',
      skipReason: 'needs-skipped',
    })
    run.dispose()
  })

  it('a timed-out sink does not replace the output of a sink that finished', async () => {
    const wizard = defineWizard(
      { name: 'sink-timeout', context: z.object({}), events },
      ({ step, steps }) =>
        steps(
          {
            work: step({ run: () => 'worked' }),
            reply: step({
              waitFor: { decided: ({ payload }) => ({ done: payload.by }) },
              timeout: { after: '1h', next: 'close' },
            }),
            close: step({ targets: ['work'], next: () => null }),
          },
          { start: ['work', 'reply'] },
        ),
    )
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler: clock })
    await run.start()
    clock.advance(HOUR)
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'worked' })
    expect(run.getState().steps.close.status).toBe('done')
    run.dispose()
  })

  it('fires an overdue timeout on resume and restores a timed-out wait as skipped', async () => {
    const wizard = approval([])
    const first = wizard.create({}, { scheduler: createTestScheduler({ now: 0 }) })
    await first.start()
    const waiting = JSON.parse(JSON.stringify(first.getSnapshot())) as unknown
    first.dispose()

    const second = wizard.resume(waiting, { scheduler: createTestScheduler({ now: 2 * HOUR }) })
    expect(await second.awaitResult()).toMatchObject({ status: 'done' })
    const expected = {
      decision: { status: 'skipped', skipReason: 'timeout' },
      notify: { status: 'skipped', skipReason: 'needs-skipped' },
      summary: { status: 'done', output: 'nobody' },
      expired: { status: 'done', output: 'expired' },
    }
    expect(second.getState().steps).toMatchObject(expected)
    const finished = JSON.parse(JSON.stringify(second.getSnapshot())) as unknown
    second.dispose()

    const third = wizard.resume(finished)
    expect(third.getState().steps).toMatchObject(expected)
    expect(third.getState().status).toBe('done')
    third.dispose()
  })

  it('does not compensate on a timeout, and leaves the skipped wait out of a later undo', async () => {
    const undone: string[] = []
    const wizard = defineWizard(
      { name: 'saga-timeout', context: z.object({}), events, onFailure: 'compensate' },
      ({ step, steps }) =>
        steps({
          charge: step({
            run: () => 'charge-1',
            compensate: ({ output }) => {
              undone.push(output)
            },
            next: 'reply',
          }),
          reply: step({
            waitFor: { decided: ({ payload }) => ({ done: payload.by }) },
            timeout: { after: '1h', next: 'escalate' },
            next: 'ship',
          }),
          ship: step({ run: () => 'shipped' }),
          escalate: step({
            waitFor: { decided: () => ({ fail: 'nobody can approve' }) },
          }),
        }),
    )
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler: clock })
    await run.start()
    clock.advance(HOUR)
    expect(run.getState().steps.reply).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(run.getState().status).toBe('waiting')
    expect(undone).toEqual([])

    await run.send('decided', { by: 'ada' })
    await run.awaitResult()
    expect(undone).toEqual(['charge-1'])
    expect(run.getState().steps.reply).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(run.getState().steps.charge.status).toBe('compensated')
    run.dispose()
  })

  it('aborts a handler that is still running when the deadline passes', async () => {
    let signal: AbortSignal | undefined
    const wizard = defineWizard(
      { name: 'abort-timeout', context: z.object({}), events },
      ({ step, steps }) =>
        steps({
          reply: step({
            waitFor: {
              decided: (args) => {
                signal = args.signal
                return new Promise<undefined>(() => {})
              },
            },
            timeout: { after: '1h', next: 'expired' },
          }),
          expired: step({ run: () => 'expired' }),
        }),
    )
    const clock = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler: clock })
    await run.start()
    void run.send('decided', { by: 'ada' })
    await run.whenIdle()
    expect(signal?.aborted).toBe(false)
    clock.advance(HOUR)
    expect(signal?.aborted).toBe(true)
    expect(run.getState().steps.reply).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
    expect(run.getState().steps.expired).toMatchObject({ status: 'done', output: 'expired' })
    run.dispose()
  })
})
