/** `prepareGraph`: a graph laid out ahead of time has its height before a component asks. */
import { inspect } from '@openwizard/core/inspect'
import { expect, it } from 'vitest'
import { lastHeight, prepareGraph } from '../src/graph/prepare'
import { pipeline } from './fixture'

const graph = inspect(pipeline)

it('records the height the graph will set for itself', async () => {
  const bounds = { min: 120, max: 480 }
  expect(lastHeight(graph, bounds)).toBeUndefined()
  await prepareGraph(graph, { width: 720, autoHeight: bounds })
  const height = lastHeight(graph, bounds)
  expect(height).toBeGreaterThanOrEqual(bounds.min)
  expect(height).toBeLessThanOrEqual(bounds.max)
})

it('keeps heights apart by bounds, and does nothing without a width', async () => {
  const other = { min: 200, max: 300 }
  await prepareGraph(graph, { width: 0, autoHeight: other })
  expect(lastHeight(graph, other)).toBeUndefined()
})
