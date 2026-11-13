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
    'waiting',
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
