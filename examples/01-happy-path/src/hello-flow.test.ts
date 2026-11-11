import { describe, expect, it } from 'vitest'
import { helloFlow } from './hello-flow'

describe('helloFlow', () => {
  it('returns a greeting', async () => {
    const run = helloFlow.create({ name: 'Ada' })

    await expect(run.start()).resolves.toMatchObject({ ok: true })
    await expect(run.awaitResult()).resolves.toMatchObject({
      status: 'done',
      output: 'Hello, Ada!',
    })

    run.dispose()
  })
})
