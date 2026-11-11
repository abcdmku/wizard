/**
 * D14: `progress(value)` from a hook reaches `observe()` as a transient `step.progress` event; it
 * never enters the state, the snapshot or the event log.
 */
import { describe, expect, it } from 'vitest'
import { flow, runStep } from '../helpers/fixtures'
import { e2e } from '../wizard/e2e/harness'

describe('progress()', () => {
  it('is observed but never logged or persisted', async () => {
    let finish = (): void => {}
    const def = flow({
      start: 'upload',
      steps: {
        upload: runStep({
          run: ({ progress }) => {
            progress({ sent: 1, total: 2 })
            return new Promise<void>((resolve) => {
              finish = () => {
                progress({ sent: 2, total: 2 })
                resolve()
              }
            })
          },
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    const seq = t.run.getState().seq
    finish()
    await t.run.awaitResult()

    expect(t.of('step.progress')).toEqual([
      {
        type: 'step.progress',
        step: 'upload',
        value: { sent: 1, total: 2 },
        seq,
        at: 10_000,
        path: [],
      },
      expect.objectContaining({ step: 'upload', value: { sent: 2, total: 2 } }),
    ])
    expect(t.run.log().some((e) => e.type === 'step.progress')).toBe(false)
    expect(JSON.stringify(t.run.getSnapshot())).not.toContain('sent')
  })
})
