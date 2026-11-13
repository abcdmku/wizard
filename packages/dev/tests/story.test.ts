import { expect, it } from 'vitest'
import { runTag } from '../src/ui/format'
import { collapse, elapsed, type LooseEvent, lines } from '../src/ui/story'

const at = 1_000_000
const event = (seq: number, ms: number, type: string, fields: Record<string, unknown> = {}) =>
  ({ seq, at: at + ms, type, path: [], ...fields }) as LooseEvent

// The events of a refund run, cut down: a form, a service step, a routing step and an event wait.
const events: LooseEvent[] = [
  event(1, 0, 'run.started', { start: 'request' }),
  event(2, 0, 'step.arrived', { step: 'order' }),
  event(3, 0, 'step.entered', { step: 'order' }),
  event(4, 0, 'step.runStarted', { step: 'order', attempt: 1 }),
  event(5, 0, 'transition.phase', { phase: 'entering' }),
  event(6, 0, 'step.entered', { step: 'request' }),
  event(7, 820, 'step.done', { step: 'order', output: { total: 250 }, durationMs: 820 }),
  event(8, 1500, 'input.changed', { step: 'request' }),
  event(9, 1501, 'step.validated', { step: 'request', output: {} }),
  event(10, 1501, 'step.entered', { step: 'route' }),
  event(11, 1501, 'step.done', { step: 'route', next: ['managerApproval'], causedBy: 10 }),
  event(12, 1501, 'step.skipped', { step: 'policyApproval', reason: 'not-taken' }),
  event(13, 1501, 'step.entered', { step: 'managerApproval' }),
  event(14, 2200, 'event.delivered', { event: 'refund.approved', to: 'managerApproval' }),
  event(15, 2300, 'step.runFailed', {
    step: 'pay',
    attempt: 1,
    error: { message: 'Service unavailable' },
    willRetry: true,
  }),
  event(16, 2300, 'step.retryScheduled', { step: 'pay', attempt: 2, dueAt: at + 3300 }),
  event(17, 3400, 'run.done', { output: {} }),
]

it('tells the story of a run in sentences and hides the bookkeeping', () => {
  const told = lines(events)
  const story = told
    .filter((line) => line.story)
    .map((line) => [line.step?.join(' / '), line.text].filter(Boolean).join(' '))
  expect(story).toEqual([
    'Run started at request',
    'order started',
    'request started waiting',
    'order finished in 0.8s',
    'request form submitted',
    'route chose managerApproval',
    'policyApproval was skipped: the route chose another step',
    'managerApproval started waiting',
    'managerApproval received refund.approved',
    'pay attempt 1 failed: Service unavailable',
    'pay will try again in 1.0s',
    'Run finished',
  ])
  // Every event still has a line for "All events".
  expect(told).toHaveLength(events.length)
  expect(told[4]?.text).toBe('transition.phase entering')
})

it('writes spans short and run ids as four characters', () => {
  expect(elapsed(820)).toBe('0.8s')
  expect(elapsed(42_000)).toBe('42s')
  expect(elapsed(245_000)).toBe('4m 05s')
  expect(runTag('wiz_q8sca5wkmwe98b4z_1')).toBe('q8sc')
  expect(runTag('order-123456789')).toBe('456789')
})

it('names the child run an event belongs to and tells a child status once', () => {
  const told = lines([
    event(1, 0, 'run.started', { start: 'shipping' }),
    event(2, 0, 'child.started', { step: 'shipping' }),
    event(1, 0, 'run.started', { path: ['shipping'], start: 'street' }),
    event(3, 0, 'child.summary', { step: 'shipping', summary: { status: 'waiting' } }),
    event(4, 1600, 'child.summary', { step: 'shipping', summary: { status: 'waiting' } }),
    event(2, 1600, 'step.validated', { path: ['shipping'], step: 'street', output: {} }),
    event(3, 1600, 'run.done', { path: ['shipping'], output: {} }),
    event(5, 1600, 'child.summary', { step: 'shipping', summary: { status: 'done' } }),
    event(6, 1700, 'run.done', { output: {} }),
  ])
  const story = told
    .filter((line) => line.story)
    .map((line) => [line.step?.join(' / '), line.text].filter(Boolean).join(' '))
  expect(story).toEqual([
    'Run started at shipping',
    'shipping started a child run',
    'shipping run started at street',
    'shipping child run waiting',
    'shipping / street form submitted',
    'shipping run finished',
    'shipping child run done',
    'Run finished',
  ])
})

it('collapses the same sentence in a row into one row with a count', () => {
  const rows = collapse(['a', 'a', 'b', 'a', 'a', 'a'], (row) => row)
  expect(rows).toEqual([
    { row: 'a', times: 2 },
    { row: 'b', times: 1 },
    { row: 'a', times: 3 },
  ])
})

it('says a refused form once', () => {
  const told = lines([
    event(1, 0, 'step.validationFailed', {
      step: 'contact',
      issues: [{ message: 'Invalid email address' }],
    }),
    event(2, 0, 'transition.rejected', { step: 'contact', reason: 'validation' }),
  ])
  expect(told.filter((line) => line.story).map((line) => line.text)).toEqual([
    'form refused: Invalid email address',
  ])
})
