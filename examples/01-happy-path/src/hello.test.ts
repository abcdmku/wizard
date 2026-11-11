import { describe, expect, it } from 'vitest'
import { hello } from './hello'

describe('hello', () => {
  it('returns a greeting', async () => {
    const run = hello.create({ name: 'Ada' })

    await expect(run.start()).resolves.toMatchObject({ ok: true })
    await expect(run.awaitResult()).resolves.toMatchObject({
      status: 'done',
      output: 'Hello, Ada!',
    })

    run.dispose()
  })
})
