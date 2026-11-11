import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compile } from '../../src/authoring/compile'
import { defineWizard } from '../../src/wizard/define-wizard'
import { issuesOf, rawFlow, rawStep } from './helpers'

describe('event wait definitions', () => {
  it('keeps passive events active alongside a dedicated completion event', async () => {
    const wizard = defineWizard(
      {
        name: 'passive-wait',
        context: z.object({ note: z.string() }),
        events: { note: z.string(), approved: z.boolean() },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            on: { note: ({ payload, update }) => update({ note: payload }) },
            waitFor: { approved: ({ context }) => ({ done: context.note }) },
          }),
        }),
    )
    const run = wizard.create({ note: '' })
    try {
      await run.start()
      await run.send('note', 'ready')
      expect(run.getState().context).toEqual({ note: 'ready' })
      expect(run.waitingFor()).toEqual([
        { kind: 'event', path: [], step: 'waiting', events: ['approved'] },
      ])
      await run.send('approved', true)
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'ready' })
    } finally {
      run.dispose()
    }
  })

  it('keeps waiting until done and runs its static successor once', async () => {
    let calls = 0
    const wizard = defineWizard(
      { name: 'wait-then-run', context: z.object({}), events: { approved: z.boolean() } },
      ({ step, steps }) => {
        const approval = step({
          waitFor: {
            approved: ({ payload }) => (payload ? { done: 'approved' } : { keep: true }),
          },
          next: 'work',
        })
        return steps({
          approval,
          work: step({ needs: { approval }, run: ({ needs }) => `${needs.approval}:${++calls}` }),
        })
      },
    )
    const run = wizard.create({})
    try {
      await run.start()
      expect(calls).toBe(0)
      await run.send('approved', false)
      expect(calls).toBe(0)
      expect(run.waitingFor()).toEqual([
        { kind: 'event', path: [], step: 'approval', events: ['approved'] },
      ])
      await run.send('approved', true)
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'approved:1' })
      expect(calls).toBe(1)
    } finally {
      run.dispose()
    }
  })

  it('uses the parsed payload when the handler returns nothing', async () => {
    const wizard = defineWizard(
      {
        name: 'payload-wait',
        context: z.object({}),
        events: { received: z.object({ n: z.string().transform(Number) }) },
      },
      ({ step, steps }) => steps({ waiting: step({ waitFor: { received: () => undefined } }) }),
    )
    const run = wizard.create({})
    try {
      await run.start()
      await run.send('received', { n: '12' })
      expect(await run.awaitResult()).toMatchObject({
        status: 'done',
        output: { n: 12 },
      })
    } finally {
      run.dispose()
    }
  })

  it('a fail result halts the run instead of activating next', async () => {
    let calls = 0
    const wizard = defineWizard(
      { name: 'rejected', context: z.object({}), events: { reject: z.string() } },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: { reject: ({ payload }) => ({ fail: payload }) },
            next: 'work',
          }),
          work: step({ run: () => ++calls }),
        }),
    )
    const run = wizard.create({})
    try {
      await run.start()
      await run.send('reject', 'declined')
      expect(await run.awaitOutcome()).toMatchObject({ status: 'halted' })
      expect(calls).toBe(0)
    } finally {
      run.dispose()
    }
  })

  it('rejects reducer records at the JavaScript definition boundary', () => {
    expect(
      issuesOf(() =>
        compile(
          rawFlow(
            { waiting: rawStep({ waitFor: { event: { reduce: () => ({}) } } }) },
            { events: { event: z.object({}) } },
          ),
        ),
      ),
    ).toEqual([
      "step 'waiting': waitFor['event'] must be a function",
      "step 'waiting': 'waitFor' must contain at least one event handler",
    ])
  })
})
