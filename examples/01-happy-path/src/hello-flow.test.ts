import { createRun } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { helloFlow } from './hello-flow'

describe('helloFlow', () => {
  it('returns a greeting', async () => {
    const run = createRun(helloFlow, { context: { name: 'Ada' } })

    await expect(run.start()).resolves.toMatchObject({ ok: true })
    await expect(run.awaitResult()).resolves.toMatchObject({
      status: 'done',
      output: 'Hello, Ada!',
    })

    run.dispose()
  })
})
