import { expect, it } from 'vitest'
import { result } from './factory'
import { onboarding } from './factory-composition'
import { submitSignup } from './factory-form'
import { loadCustomer } from './factory-services'

it('executes the factory examples', async () => {
  expect(result).toMatchObject({ status: 'done', output: 'Hello, Ada!' })
  expect(await submitSignup('ada@example.com')).toMatchObject({
    status: 'done',
    output: { email: 'ada@example.com' },
  })
  expect(await submitSignup('invalid')).toMatchObject({ ok: false })
  expect(await loadCustomer('42')).toMatchObject({
    status: 'done',
    output: { id: '42', name: 'Customer 42' },
  })
  const run = onboarding.create({})
  try {
    await run.start()
    const child = run.child('signup')
    await child.setInput('contact', { email: 'ada@example.com' })
    await child.next()
    expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'ada@example.com' })
  } finally {
    run.dispose()
  }
})
