/**
 * D12: `retry.when` decides per failure whether the step retries. It sees the `mapError` value
 * when the step maps errors, else the raw thrown value.
 */
import { describe, expect, it } from 'vitest'
import { flow, runStep } from '../helpers/fixtures'
import { e2e, tick } from '../wizard/e2e/harness'

const failing = (messages: string[]) => {
  let calls = 0
  return {
    calls: () => calls,
    run: async () => {
      calls += 1
      throw new Error(messages[calls - 1] ?? 'fatal')
    },
  }
}

describe('retry.when', () => {
  it('retries only the errors it accepts (raw error)', async () => {
    const work = failing(['timeout', 'fatal'])
    const def = flow({
      start: 't',
      steps: {
        t: runStep({
          run: work.run,
          retry: { attempts: 5, when: (error) => (error as Error).message === 'timeout' },
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    await tick()
    t.sched.flush()
    await tick()
    expect(work.calls()).toBe(2)
    expect(t.run.getState().status).toBe('halted')
    expect(t.rec('t').error).toMatchObject({ message: 'fatal', attempt: 2 })
  })

  it('receives the mapError value when the step maps errors', async () => {
    const seen: unknown[] = []
    const def = flow({
      start: 't',
      steps: {
        t: runStep({
          run: failing([]).run,
          mapError: ({ error }) => ({ code: (error as Error).message.toUpperCase() }),
          retry: {
            attempts: 3,
            when: (error) => {
              seen.push(error)
              return false
            },
          },
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    await tick()
    expect(seen).toEqual([{ code: 'FATAL' }])
    expect(t.rec('t').error).toMatchObject({ data: { code: 'FATAL' }, attempt: 1 })
  })
})
