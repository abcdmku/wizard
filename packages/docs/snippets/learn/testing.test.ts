import { describe, expect, it } from 'vitest'
import { signupWizard } from './form'

describe('signupWizard', () => {
  it('rejects an invalid email', async () => {
    const run = signupWizard.create({})
    await run.start()
    await run.setInput('contact', { email: 'not-an-email' })

    const result = await run.next()

    expect(result.ok).toBe(false)
    expect(run.getState().current).toBe('contact')
    run.dispose()
  })
})
