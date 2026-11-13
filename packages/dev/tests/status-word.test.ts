import type { Manifest } from '@openwizard/core/inspect'
import { describe, expect, it } from 'vitest'
import { span } from '../src/ui/format'
import { issueText } from '../src/ui/json'
import { sentBy } from '../src/ui/kind'
import { notRunWhy } from '../src/ui/not-run'
import { attentionOf, stepWord } from '../src/ui/status-word'
import { triesOf } from '../src/ui/step-facts'
import type { RunDetail } from '../src/wire'

/** A run with the given status and root step statuses, and nothing else the rule reads. */
const runOf = (
  status: string,
  steps: Record<string, string>,
  pending: RunDetail['pending'] = [],
): RunDetail =>
  ({
    status,
    pending,
    phases: {},
    snapshot: {
      state: {
        steps: Object.fromEntries(Object.entries(steps).map(([id, s]) => [id, { status: s }])),
      },
      children: {},
    },
  }) as unknown as RunDetail

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'step',
  path: [],
  hooks: [],
  ...extra,
})

// incident: ack waits five minutes and times out to escalate; price: live falls back to list.
const manifest = {
  nodes: [
    node('ack', { waitsFor: ['incident.acked'], timeout: 300_000 }),
    node('escalate'),
    node('live', { fallback: 'list' }),
    node('list'),
    node('health'),
    node('promote'),
  ],
  edges: [
    { from: null, to: 'ack', kind: 'start', path: [] },
    { from: 'ack', to: 'escalate', kind: 'timeout', path: [] },
    { from: 'live', to: 'list', kind: 'fallback', path: [] },
    { from: 'health', to: 'promote', kind: 'needs', mode: 'all', path: [] },
  ],
} as unknown as Manifest

describe('stepWord', () => {
  it('says blocked while an idle step can still start', () => {
    expect(stepWord('idle')).toBe('blocked')
  })
  it('says not run once the run ended or the step can no longer start', () => {
    expect(stepWord('idle', undefined, { ended: true })).toBe('not run')
    expect(stepWord('idle', undefined, { closed: true })).toBe('not run')
    expect(stepWord(undefined, undefined, { closed: true, person: true })).toBe('not run')
  })
  it('keeps the word of a step that started', () => {
    expect(stepWord('done', undefined, { closed: true })).toBe('done')
  })
})

describe('notRunWhy', () => {
  it('names a timeout that did not fire once the wait was answered', () => {
    const run = runOf('running', { ack: 'done', escalate: 'idle' })
    expect(notRunWhy(run, manifest, 'escalate')).toBe('ack was answered before its 5m timeout.')
  })
  it('keeps that reason after the run finished', () => {
    const run = runOf('done', { ack: 'done', escalate: 'idle' })
    expect(notRunWhy(run, manifest, 'escalate')).toBe('ack was answered before its 5m timeout.')
  })
  it('leaves a timeout target open while the wait goes on or when it timed out', () => {
    expect(notRunWhy(runOf('waiting', { ack: 'active' }), manifest, 'escalate')).toBeUndefined()
    expect(notRunWhy(runOf('running', { ack: 'skipped' }), manifest, 'escalate')).toBeUndefined()
  })
  it('names a fallback that was not needed', () => {
    const run = runOf('running', { live: 'done', list: 'idle' })
    expect(notRunWhy(run, manifest, 'list')).toBe(
      'live did not fail, so its fallback was not needed.',
    )
    expect(notRunWhy(runOf('running', { live: 'failed' }), manifest, 'list')).toBeUndefined()
  })
  it('says where a run failed, halted or started undoing', () => {
    const steps = { health: 'failed', promote: 'idle' }
    expect(notRunWhy(runOf('failed', steps), manifest, 'promote')).toBe('The run failed at health.')
    expect(notRunWhy(runOf('compensating', steps), manifest, 'promote')).toBe(
      'The run is undoing its work after health failed.',
    )
    const halted = runOf('halted', steps, [{ kind: 'failed', step: 'health' }])
    expect(notRunWhy(halted, manifest, 'promote')).toBe('The run halted at health.')
  })
  it('leaves a step blocked on a need that is still running', () => {
    expect(notRunWhy(runOf('running', { health: 'active' }), manifest, 'promote')).toBeUndefined()
  })
})

describe('attentionOf', () => {
  const call = { kind: 'call', id: 'c1', name: 'pager.page', args: [], step: 'page', path: [] }
  it('rings the step whose call waits for a person', () => {
    expect(attentionOf(runOf('running', {}, [call] as RunDetail['pending']))).toEqual(['page'])
  })
  it('rings nothing once the run has ended', () => {
    for (const status of ['done', 'failed', 'cancelled'])
      expect(attentionOf(runOf(status, {}, [call] as RunDetail['pending']))).toEqual([])
  })
})

describe('triesOf', () => {
  it('counts every attempt and keeps the latest start and its duration', () => {
    const events = [
      { type: 'step.runStarted', step: 'save', path: [], at: 1000 },
      { type: 'step.runStarted', step: 'save', path: [], at: 3000 },
      { type: 'step.runStarted', step: 'other', path: [], at: 3500 },
      { type: 'step.runStarted', step: 'save', path: [], at: 9000 },
      { type: 'step.done', step: 'save', path: [], at: 10_300, durationMs: 1300 },
    ]
    expect(triesOf(events, 'save')).toEqual({ count: 3, first: 1000, last: 9000, took: 1300 })
  })
})

describe('copy', () => {
  it('formats a duration as the graph does', () => {
    expect(span(48 * 3_600_000)).toBe('48h')
    expect(span(7 * 86_400_000)).toBe('7d')
    expect(span(300_000)).toBe('5m')
    expect(span(600_000)).toBe('10m')
    expect(span(1000)).toBe('1s')
    expect(span(250)).toBe('250ms')
  })
  it('says a missing value is required', () => {
    expect(
      issueText({ message: 'Invalid input: expected string, received undefined', path: ['by'] }),
    ).toBe('by is required')
    expect(issueText({ message: 'Too small', path: ['by'] })).toBe('Too small')
  })
  it('says who sends an event without a "Sent by:" label', () => {
    expect(sentBy('webhook', 'Back office')).toBe(
      'Back office posts this to a signed webhook route.',
    )
    expect(sentBy('queue', 'Back office')).toBe('Back office puts this on a queue.')
    expect(sentBy('event', 'Back office')).toBe('Your code sends this.')
    expect(sentBy('event')).toBe('Your code sends this.')
  })
})
