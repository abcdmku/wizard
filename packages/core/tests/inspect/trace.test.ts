import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { formatTrace } from '../../src/inspect'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { RunEvent } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('formatTrace', () => {
  it('narrates a run one line per event, relative to the first event, without bookkeeping', async () => {
    let calls = 0
    const wizard = defineWizard(
      {
        name: 'charge',
        context: boundary.trusted<{}>(),
        retry: { attempts: 2, backoff: 250 },
      },
      ({ step, view, steps }) =>
        steps({
          form: view({ input: boundary.trusted<{}>(), next: 'charge' }),
          charge: step({
            run: async () => {
              calls += 1
              if (calls === 1) throw new Error('PSP down')
              return 'ok'
            },
            next: 'done',
          }),
          done: step({ next: null }),
        }),
    )
    const scheduler = createTestScheduler({ now: 1_000 })
    const run = wizard.create({}, { scheduler })
    const events: RunEvent<typeof wizard>[] = []
    run.observe((event) => events.push(event))
    await run.start()
    await run.next()
    scheduler.advance(250)
    await run.awaitResult()

    expect(formatTrace(events)).toBe(
      [
        '+0ms      run started at form',
        '+0ms      form entered',
        '+0ms      moved (start) -> form',
        '+0ms      form input valid',
        '+0ms      moved form -> charge',
        '+0ms      charge entered',
        '+0ms      charge attempt 1 started',
        '+0ms      charge attempt 1 failed: PSP down, will retry',
        '+0ms      charge retry (attempt 2) at +250ms',
        '+250ms    charge attempt 2 started',
        '+250ms    charge attempt 2 succeeded',
        '+250ms    charge done',
        '+250ms    moved charge -> done',
        '+250ms    done entered',
        '+250ms    done done',
        '+250ms    run done',
      ].join('\n'),
    )
  })
})
