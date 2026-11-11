/**
 * `useStep(view)` over a Run: the live `phase` while an async `validate` hook runs,
 * `next()` from a view that is not current (NOT_ACTIVE, nothing sent) and `issuesFor`.
 */
import { boundary, defineWizard, type Issue } from '@openwizard/core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { bindReact } from '../src/index'

afterEach(cleanup)

interface Deps {
  check(email: string): Promise<readonly Issue[] | undefined>
}

const signupFlow = defineWizard(
  {
    name: 'signup',
    context: z.object({}),
    deps: boundary.trusted<Deps>(),
  },
  ({ step, view, steps }) =>
    steps(
      {
        account: view({
          input: z.object({ email: z.string(), name: z.string() }),
          validate: ({ output, deps }) => deps.check(output.email),
          next: 'plan',
        }),
        plan: view({ input: z.object({ tier: z.string() }), next: 'done' }),
        done: step({ run: () => 'welcome' }),
      },
      { start: 'account' },
    ),
)
const ow = bindReact<typeof signupFlow>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function startedRun(check: Deps['check']) {
  const run = signupFlow.create({}, { deps: { check } })
  await run.start()
  await run.setInput('account', { email: 'ada@example.com', name: 'Ada' })
  return run
}

describe('useStep over a Run', () => {
  it("reports phase 'validating' while the view's async validate hook runs", async () => {
    const check = deferred<undefined>()
    const run = await startedRun(() => check.promise)
    function Phase() {
      const account = ow.useStep('account')
      const current = ow.useCurrent()
      return (
        <p data-testid="phase">
          {account.phase ?? 'none'}/{current?.id}:{current?.phase ?? 'none'}
        </p>
      )
    }
    render(
      <ow.Provider source={run}>
        <Phase />
      </ow.Provider>,
    )
    expect(screen.getByTestId('phase').textContent).toBe('waiting/account:waiting')
    let advanced: Promise<unknown> | undefined
    await act(async () => {
      advanced = run.next()
    })
    expect(screen.getByTestId('phase').textContent).toBe('validating/account:validating')
    await act(async () => {
      check.resolve(undefined)
      await advanced
    })
    expect(screen.getByTestId('phase').textContent).toBe('none/plan:waiting')
    run.dispose()
  })

  it('next() of a view that is not current resolves NOT_ACTIVE and sends nothing', async () => {
    const run = signupFlow.create({}, { deps: { check: async () => undefined } })
    await run.start()
    let planNext: (() => Promise<unknown>) | undefined
    function Plan() {
      planNext = ow.useStep('plan').next
      return null
    }
    render(
      <ow.Provider source={run}>
        <Plan />
      </ow.Provider>,
    )
    let result: unknown
    await act(async () => {
      result = await planNext?.()
    })
    expect(result).toEqual({
      ok: false,
      reason: 'not-active',
      code: 'NOT_ACTIVE',
      message:
        "useStep('plan').next(): 'plan' is not the current view (current: 'account'); nothing was sent",
      step: 'plan',
    })
    // A `next` sent to the run would have validated the empty `account` draft.
    expect(run.getState().current).toBe('account')
    expect(run.getState().steps.account.issues).toBeUndefined()
    run.dispose()
  })

  it('issuesFor(field) lists the issues of that field, issuesFor() the ones without a path', async () => {
    const run = await startedRun(async () => [
      { message: 'Email taken', path: ['email'] },
      { message: 'Name reserved', path: [{ key: 'name' }] },
      { message: 'Try again later' },
    ])
    function Issues() {
      const { issuesFor } = ow.useStep('account')
      const messages = (issues: readonly Issue[]) => issues.map((issue) => issue.message).join('|')
      return (
        <p data-testid="issues">
          {messages(issuesFor('email'))}/{messages(issuesFor('name'))}/{messages(issuesFor())}
        </p>
      )
    }
    render(
      <ow.Provider source={run}>
        <Issues />
      </ow.Provider>,
    )
    await act(async () => {
      await run.next()
    })
    expect(screen.getByTestId('issues').textContent).toBe(
      'Email taken/Name reserved/Try again later',
    )
    run.dispose()
  })
})
