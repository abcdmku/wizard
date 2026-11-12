/**
 * The runs the guide diagrams replay. Each scenario drives the wizard its page shows, from
 * `packages/docs/snippets/learn`, through the public API.
 */
import { createMemoryStore } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { delivery } from '../../../snippets/learn/branch'
import { checkout } from '../../../snippets/learn/children'
import { signup } from '../../../snippets/learn/form'
import { dashboard } from '../../../snippets/learn/needs'
import { report } from '../../../snippets/learn/steps'
import { approval } from '../../../snippets/learn/wait'
import type { Scenario } from './record'
import { failureScenarios } from './scenarios-failures'
import { refundScenarios } from './scenarios-refund'
import { deferred } from './support'

const steps: Scenario = {
  label: 'A run from start to finish',
  wizard: report,
  async play(tape) {
    const download = deferred<{ pages: number }>()
    const run = report.create(
      { reportId: 'r-1' },
      { deps: { reports: { download: tape.service('reports.download', () => download.promise) } } },
    )
    tape.track(run)
    await tape.beat(
      "const run = report.create({ reportId: 'r-1' }, { deps })",
      'A run exists. No step has started.',
    )
    await tape.beat(
      'await run.start()',
      'download is the first key, so it starts. It is waiting for the service.',
      () => run.start(),
    )
    await tape.beat(
      '// deps.reports.download resolves',
      'download finishes with the value the service returned. Its next names announce, which runs and ends the run.',
      () => download.resolve({ pages: 3 }),
    )
    await tape.beat('await run.awaitResult()', 'The output of the last step is the result.', () =>
      run.awaitResult(),
    )
    run.dispose()
  },
}

const needs: Scenario = {
  label: 'Two steps feed a third',
  wizard: dashboard,
  async play(tape) {
    const run = dashboard.create({ userId: '7' })
    tape.track(run)
    await tape.beat("const run = dashboard.create({ userId: '7' })", 'No step has started.')
    await tape.beat(
      'await run.start()',
      'profile and orders start together. summary starts when both have finished, and reads their outputs.',
      () => run.start(),
    )
    await tape.beat(
      'await run.awaitResult()',
      'summary is the last step, so its output is the result.',
      () => run.awaitResult(),
    )
    run.dispose()
  },
}

const forms: Scenario = {
  label: 'An invalid draft, then a valid one',
  wizard: signup,
  async play(tape) {
    const run = signup.create({})
    tape.track(run)
    await tape.beat('const run = signup.create({})', 'No step has started.')
    await tape.beat('await run.start()', 'The run stops at the view and waits for a person.', () =>
      run.start(),
    )
    await tape.beat(
      "await run.setInput('contact', { email: 'not-an-email' })",
      'The draft is stored as typed. Nothing is validated yet.',
      () => run.setInput('contact', { email: 'not-an-email' }),
    )
    await tape.beat(
      'await run.next()',
      'next validates the draft. It is invalid, so the run stays on the view.',
      () => run.next(),
    )
    await tape.beat(
      "await run.setInput('contact', { email: 'ada@example.com' })",
      'The person corrects the draft.',
      () => run.setInput('contact', { email: 'ada@example.com' }),
    )
    await tape.beat(
      'await run.next()',
      'The draft is valid. The parsed value becomes the output of contact, and welcome reads it.',
      () => run.next(),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

const branchTo = (speed: 'express' | 'standard'): Scenario => ({
  label: speed === 'express' ? 'Express' : 'Standard',
  wizard: delivery,
  async play(tape) {
    const other = speed === 'express' ? 'standard' : 'express'
    const run = delivery.create({ speed })
    tape.track(run)
    await tape.beat(`const run = delivery.create({ speed: '${speed}' })`, 'No step has started.')
    await tape.beat(
      'await run.start()',
      `choose returns ${speed}, so ${other} is skipped. label reads whichever branch ran.`,
      () => run.start(),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
})

const waitAnswered: Scenario = {
  label: 'The event arrives',
  wizard: approval,
  async play(tape) {
    const run = approval.create({})
    tape.track(run)
    await tape.beat('const run = approval.create({})', 'No step has started.')
    await tape.beat('await run.start()', 'decision waits for the approved event.', () =>
      run.start(),
    )
    await tape.beat(
      "await run.send('approved', { by: 42 })",
      'The payload does not match the schema. It is rejected and the step keeps waiting.',
      () => run.send('approved', { by: 42 } as never),
    )
    await tape.beat(
      "await run.send('approved', { by: 'Grace' })",
      'The handler ends the wait with the name as its output. close reads it.',
      () => run.send('approved', { by: 'Grace' }),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

const waitExpired: Scenario = {
  label: 'Nobody answers',
  wizard: approval,
  async play(tape) {
    const scheduler = createTestScheduler()
    const run = approval.create({}, { scheduler })
    tape.track(run)
    await tape.beat('const run = approval.create({}, { scheduler })', 'No step has started.')
    await tape.beat('await run.start()', 'decision waits, with a deadline 48 hours from now.', () =>
      run.start(),
    )
    await tape.beat(
      '// 48 hours pass',
      'The wait is skipped and its timeout starts close. The need is optional, so close runs with undefined.',
      () => scheduler.advance(48 * 60 * 60 * 1000),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

const saveResume: Scenario = {
  label: 'A restart between two commands',
  wizard: signup,
  async play(tape) {
    const store = createMemoryStore()
    const first = signup.create({}, { store, instanceId: 'signup-1' })
    tape.track(first)
    await tape.beat(
      "const first = signup.create({}, { store, instanceId: 'signup-1' })",
      'A run with a store. Every change schedules a write.',
    )
    await tape.beat('await first.start()', 'The run waits at the view.', () => first.start())
    await tape.beat(
      "await first.setInput('contact', { email: 'ada@example.com' })",
      'The draft is part of the run, so it is part of the snapshot.',
      () => first.setInput('contact', { email: 'ada@example.com' }),
    )
    await tape.beat(
      'await first.save(); first.dispose()',
      'The snapshot is in the store. The process stops and the run object is gone.',
      async () => {
        await first.save()
        first.dispose()
      },
    )
    const second = signup.resume(await store.get('signup-1'), { store })
    tape.track(second)
    await tape.beat(
      "const second = signup.resume(await store.get('signup-1'), { store })",
      'A new process loads the snapshot. The run is where it was, draft included.',
    )
    await tape.beat(
      'await second.next()',
      'The draft survived, so next validates it and continues.',
      () => second.next(),
    )
    await tape.beat('await second.awaitResult()', 'The run is done.', () => second.awaitResult())
    second.dispose()
  },
}

const children: Scenario = {
  label: 'A child wizard as one step',
  wizard: checkout,
  async play(tape) {
    const run = checkout.create({ country: 'NL' })
    tape.track(run)
    await tape.beat("const run = checkout.create({ country: 'NL' })", 'No step has started.')
    await tape.beat(
      'await run.start()',
      'shipping starts a run of the address wizard. That child waits at its view.',
      () => run.start(),
    )
    const form = run.child('shipping')
    await tape.beat(
      "await run.child('shipping').setInput('street', { street: 'Keizersgracht 1' })",
      'You drive the child through the parent.',
      () => form.setInput('street', { street: 'Keizersgracht 1' }),
    )
    await tape.beat(
      "await run.child('shipping').next()",
      'The child finishes. Its output becomes the output of shipping, and confirm reads it.',
      () => form.next(),
    )
    await tape.beat('await run.awaitResult()', 'The run is done.', () => run.awaitResult())
    run.dispose()
  },
}

/** Scenarios by the name a page passes to `<RunDiagram name="..." />`. */
export const scenarios: Readonly<Record<string, readonly Scenario[]>> = {
  steps: [steps],
  needs: [needs],
  forms: [forms],
  branch: [branchTo('express'), branchTo('standard')],
  wait: [waitAnswered, waitExpired],
  'save-resume': [saveResume],
  children: [children],
  ...failureScenarios,
  ...refundScenarios,
}
