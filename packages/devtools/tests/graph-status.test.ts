/**
 * The status word a card shows and the path state an edge gets, from the live statuses.
 */
import type { ManifestStep } from '@openwizard/core/inspect'
import { expect, it } from 'vitest'
import { closedSteps } from '../src/graph/paths'
import { statusWord } from '../src/graph/status-word'
import { applyEdgeOverlay, type DevtoolsEdge } from '../src/graph/to-react-flow'
import { formatMs, type ModelEdge } from '../src/layout/model'
import type { StepStatusMap } from '../src/types'

const step = (fields: Partial<ManifestStep> = {}): ManifestStep => ({
  id: 's',
  kind: 'step',
  path: [],
  hooks: ['run'],
  ...fields,
})

it('names every live status in a word', () => {
  const words = (
    [
      [{ status: 'active', phase: 'running' }, step()],
      [{ status: 'active', phase: 'waiting' }, step({ kind: 'view' })],
      [{ status: 'active', phase: 'retrying' }, step()],
      [{ status: 'active' }, step({ waitsFor: ['paid'] })],
      [{ status: 'done' }, step()],
      [{ status: 'failed' }, step()],
      [{ status: 'skipped' }, step()],
      [{ status: 'compensating', phase: 'compensating' }, step()],
      [{ status: 'compensated' }, step()],
    ] as const
  ).map(([live, s]) => statusWord(live, s)?.text)
  expect(words).toEqual([
    'running',
    'waiting on you',
    'retrying',
    'waiting',
    'done',
    'failed',
    'skipped',
    'undoing',
    'undone',
  ])
  expect(statusWord(undefined, step())).toBeUndefined()
  expect(statusWord({ status: 'active', phase: 'validating' }, step())?.text).toBe('running')
})

it('says `blocked` for every step a live run has not started, and `not run` once it ended', () => {
  for (const live of [
    { status: 'idle' },
    { status: 'idle', phase: 'ready' },
    { status: 'idle', phase: 'blocked' },
  ] as const) {
    expect(statusWord(live, step())?.text).toBe('blocked')
    expect(statusWord(live, step(), undefined, true)?.text).toBe('not run')
  }
  expect(statusWord({ status: 'done' }, step(), undefined, true)?.text).toBe('done')
})

it('says `waiting on you` for the steps the host names, and `waiting` for the rest', () => {
  const form = step({ kind: 'view' })
  const waits = { status: 'active', phase: 'waiting' } as const
  expect(statusWord(waits, form, true)?.text).toBe('waiting on you')
  expect(statusWord(waits, form, false)?.text).toBe('waiting')
  expect(statusWord({ status: 'active', phase: 'running' }, step(), true)?.text).toBe(
    'waiting on you',
  )
  expect(statusWord(undefined, step(), true)?.tone).toBe('attention')
})

it('says `undoing` for a step that is undoing, even when a person has to answer it', () => {
  const undoing = { status: 'compensating', phase: 'compensating' } as const
  expect(statusWord(undoing, step(), true)?.text).toBe('undoing')
  expect(statusWord({ status: 'failed' }, step(), true)?.text).toBe('failed')
  expect(statusWord({ status: 'idle' }, step(), true)?.text).toBe('waiting on you')
})

it('counts attempts against the retries a step allows', () => {
  const retries = step({ retry: { retries: 2 } as NonNullable<ManifestStep['retry']> })
  // While it waits to retry, the counter still holds the attempt that failed.
  const retrying = statusWord({ status: 'active', phase: 'retrying', attempt: 1 }, retries)
  expect([retrying?.text, retrying?.attempt]).toEqual(['retrying', 'attempt 2 of 3'])
  expect(statusWord({ status: 'failed', attempt: 3 }, retries)?.attempt).toBe('attempt 3 of 3')
  expect(statusWord({ status: 'failed', attempt: 1 }, step())?.attempt).toBeUndefined()
})

const edge = (source: string, target: string): DevtoolsEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'graph',
  data: { kind: 'next', back: false },
})

it('marks the edges the run took and the ones it can no longer take', () => {
  const routed = (source: string, target: string): DevtoolsEdge => ({
    ...edge(source, target),
    data: { kind: 'route', back: false },
  })
  const edges = [edge('#entry', 'a'), routed('a', 'b'), routed('a', 'c'), edge('b', 'd')]
  const overlay = {
    statuses: {
      a: { status: 'done' },
      b: { status: 'active' },
      c: { status: 'skipped' },
      d: { status: 'idle' },
    },
    current: null,
    selected: null,
  } as const
  expect(applyEdgeOverlay(edges, overlay).map((e) => e.data?.path)).toEqual([
    'taken',
    'taken',
    'untaken',
    undefined,
  ])
  expect(
    applyEdgeOverlay(edges, { statuses: {}, current: null, selected: null }).map(
      (e) => e.data?.path,
    ),
  ).toEqual([undefined, undefined, undefined, undefined])
})

const alt = (source: string, target: string, kind: 'timeout' | 'fallback', need = false) => ({
  ...edge(source, target),
  id: `${kind}:${source}->${target}`,
  data: { kind, back: false, ...(need ? { need: true } : {}) },
})
const pathsOf = (edges: DevtoolsEdge[], statuses: StepStatusMap) =>
  applyEdgeOverlay(edges, { statuses, current: null, selected: null }).map((e) => e.data?.path)

it('draws a timeout or fallback line as taken once the run goes that way, and not taken otherwise', () => {
  // incident: page -> ack, ack times out to escalate, resolved needs any of ack or escalate.
  const edges = [edge('page', 'ack'), alt('ack', 'escalate', 'timeout'), edge('ack', 'resolved')]
  const timedOut: StepStatusMap = {
    page: { status: 'done' },
    ack: { status: 'skipped', attempt: 1 },
    escalate: { status: 'done' },
    resolved: { status: 'active' },
  }
  expect(pathsOf(edges, timedOut)).toEqual(['taken', 'taken', 'untaken'])
  // The wait was reached even when the snapshot keeps no attempt for it.
  expect(pathsOf(edges, { ...timedOut, ack: { status: 'skipped' } })[0]).toBe('taken')
  const acked: StepStatusMap = {
    page: { status: 'done' },
    ack: { status: 'done' },
    escalate: { status: 'idle' },
    resolved: { status: 'active' },
  }
  expect(pathsOf(edges, acked)).toEqual(['taken', 'untaken', 'taken'])
  // A failed call that falls back: the fallback line is taken.
  const fallback = [edge('#entry', 'live'), alt('live', 'list', 'fallback')]
  const failed: StepStatusMap = {
    live: { status: 'skipped', attempt: 1 },
    list: { status: 'done' },
  }
  expect(pathsOf(fallback, failed)).toEqual(['taken', 'taken'])
  // A timeout line that also carries a need is taken when the wait finishes in time.
  const carried = [alt('decision', 'close', 'timeout', true)]
  // The wait finished in time, so the run went along the need the line carries.
  expect(pathsOf(carried, { decision: { status: 'done' }, close: { status: 'done' } })).toEqual([
    'carried',
  ])
})

const model = (source: string, target: string, kind: ModelEdge['kind'], label?: string) => ({
  key: `${kind}:${source}->${target}`,
  source,
  target,
  kind,
  path: [],
  ...(label === undefined ? {} : { label }),
})

it('finds the idle steps that can no longer start', () => {
  const incident = [
    model('ack', 'escalate', 'timeout', 'times out after 5m'),
    model('ack', 'resolved', 'needs', 'any need: owner'),
    model('escalate', 'resolved', 'needs', 'any need: owner'),
  ]
  const acked: StepStatusMap = {
    ack: { status: 'done' },
    escalate: { status: 'idle' },
    resolved: { status: 'active' },
  }
  expect([...closedSteps(incident, acked)]).toEqual(['escalate'])
  expect([...closedSteps(incident, { ...acked, ack: { status: 'active' } })]).toEqual([])
  // A need it cannot run without failed, so it cannot start.
  const deploy = [model('build', 'promote', 'needs'), model('health', 'promote', 'needs')]
  const failed: StepStatusMap = {
    build: { status: 'done' },
    health: { status: 'failed' },
    promote: { status: 'idle' },
  }
  expect([...closedSteps(deploy, failed)]).toEqual(['promote'])
  // A timeout target with an optional need on the wait still runs when the wait finishes.
  const wait = [
    model('decision', 'close', 'timeout', 'times out after 48h'),
    model('decision', 'close', 'needs', 'optional need: by'),
  ]
  const answered: StepStatusMap = { decision: { status: 'done' }, close: { status: 'idle' } }
  expect([...closedSteps(wait, answered)]).toEqual([])
  // A step runs without an optional need, so the need never closes the way in.
  const optional = [model('a', 'b', 'needs', 'optional need: a')]
  expect([...closedSteps(optional, { a: { status: 'skipped' }, b: { status: 'idle' } })]).toEqual(
    [],
  )
  const word = (reason: 'closed' | 'undoing' | 'ended') =>
    statusWord({ status: 'idle' }, step(), undefined, reason)
  expect(word('closed')?.text).toBe('not run')
  expect(word('undoing')?.title).toMatch(/undoing/)
})

it('prints a duration as whole hours under 72, else the largest whole unit', () => {
  expect(
    [5 * 60_000, 10 * 60_000, 2 * 3_600_000, 48 * 3_600_000, 72 * 3_600_000, 7 * 86_400_000].map(
      formatMs,
    ),
  ).toEqual(['5m', '10m', '2h', '48h', '3d', '7d'])
  expect([90 * 60_000, 1_500, 250].map(formatMs)).toEqual(['90m', '1.5s', '250ms'])
})
