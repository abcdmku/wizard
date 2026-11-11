import { signupFlow } from './form'

export async function changeContact() {
  const run = signupFlow.create({})
  try {
    await run.start()
    const { epoch, seq } = run.getState()
    const options = { expectedVersion: { epoch, seq } }

    const first = await run.dispatch(
      { type: 'setInput', step: 'contact', patch: { email: 'ada@example.com' } },
      options,
    )
    // The first update advances the version, so this old version is refused.
    const stale = await run.dispatch(
      { type: 'setInput', step: 'contact', patch: { email: 'grace@example.com' } },
      options,
    )
    return { first, stale }
  } finally {
    run.dispose()
  }
}
