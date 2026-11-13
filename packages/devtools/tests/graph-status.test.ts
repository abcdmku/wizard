/**
 * The status word a card shows and the path state an edge gets, from the live statuses.
 */
import type { ManifestStep } from '@openwizard/core/inspect'
import { expect, it } from 'vitest'
import { statusWord } from '../src/graph/status-word'
import { applyEdgeOverlay, type DevtoolsEdge } from '../src/graph/to-react-flow'

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
  expect(statusWord({ status: 'idle', phase: 'ready' }, step())).toBeUndefined()
  expect(statusWord(undefined, step())).toBeUndefined()
  expect(statusWord({ status: 'idle', phase: 'blocked' }, step())?.text).toBe('blocked')
  expect(statusWord({ status: 'active', phase: 'validating' }, step())?.text).toBe('running')
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
  const edges = [edge('#entry', 'a'), edge('a', 'b'), edge('a', 'c'), edge('b', 'd')]
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
