import { createRun } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { signupFlow } from './form'

describe('signupFlow', () => {
  it('rejects an invalid email', async () => {
    const run = createRun(signupFlow, { context: {} })
    await run.start()
    await run.setInput('contact', { email: 'not-an-email' })

    const result = await run.next()

    expect(result.ok).toBe(false)
    expect(run.getState().current).toBe('contact')
    run.dispose()
  })
})
