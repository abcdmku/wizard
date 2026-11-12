import { expect, it } from 'vitest'
import { focusOf } from '../src/graph/Follow'

const node = (id: string, start = false) =>
  ({ id, type: 'step', data: { step: { start } } }) as unknown as Parameters<
    typeof focusOf
  >[0][number]
const nodes = [node('order', true), node('request', true), node('route'), node('pay')]

it('centres on the steps that start the wizard when no run is shown', () => {
  expect(focusOf(nodes, {})).toEqual(['order', 'request'])
})

it('centres on the steps that are running, waiting or failed', () => {
  expect(
    focusOf(nodes, {
      order: { status: 'done' },
      request: { status: 'done' },
      route: { status: 'active' },
      pay: { status: 'idle' },
    }),
  ).toEqual(['route'])
  expect(focusOf(nodes, { order: { status: 'failed' }, request: { status: 'active' } })).toEqual([
    'order',
    'request',
  ])
})

it('centres on the last finished step of a finished run', () => {
  const done = Object.fromEntries(nodes.map((item) => [item.id, { status: 'done' as const }]))
  expect(focusOf(nodes, done)).toEqual(['pay'])
})
