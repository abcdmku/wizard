import { createMemoryStore } from '@openwizard/core'
import { signup } from './form' // the wizard from Forms

export async function signupAcrossRestart() {
  const store = createMemoryStore()

  const first = signup.create({}, { store, instanceId: 'signup-1' })
  await first.start()
  await first.setInput('contact', { email: 'ada@example.com' })
  await first.save() // wait for the snapshot to reach the store
  first.dispose() // the process stops here

  const second = signup.resume(await store.get('signup-1'), { store })
  await second.next() // the draft survived
  const result = await second.awaitResult() // { status: 'done', output: 'Welcome, ada@example.com' }
  second.dispose()
  return result
}
