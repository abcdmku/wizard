/**
 * Framing a graph too large to show whole: whole layers only, the focus and what follows it
 * first, and the layers either side wholly out of view.
 */
import { expect, it } from 'vitest'
import { chooseLayout } from '../src/graph/direction'
import { type Box, frameView } from '../src/graph/frame'
import type { LayoutResult } from '../src/layout/elk'
import { pickHandles } from '../src/layout/handles'
import { drawnEdges } from '../src/layout/merge'
import type { ModelEdge } from '../src/layout/model'

/** Six layers of one card each, 160 wide with 44 between them. */
const row: Box[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
  id,
  x: i * 204,
  y: 0,
  width: 160,
  height: 46,
}))
const padding = { top: 44, right: 20, bottom: 20, left: 20 }

it('keeps whole steps in view around the focus, the step after it first', () => {
  const pane = { width: 600, height: 300 }
  const view = frameView({
    boxes: row,
    focus: ['c'],
    pane,
    padding,
    direction: 'right',
    floor: 0.79,
    maxZoom: 1,
  })
  expect(view.zoom).toBeGreaterThanOrEqual(0.79)
  const shown = row.filter((box) => {
    const left = box.x * view.zoom + view.x
    return left + box.width * view.zoom > 0 && left < pane.width
  })
  // Every step that reaches into the pane is wholly inside it.
  for (const box of shown) {
    const left = box.x * view.zoom + view.x
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + box.width * view.zoom).toBeLessThanOrEqual(pane.width)
  }
  expect(shown.map((box) => box.id)).toContain('c')
  expect(shown.map((box) => box.id)).toContain('d')
})

it('works the same down the page', () => {
  const column = row.map((box) => ({ ...box, x: 0, y: box.x / 2, width: 160, height: 46 }))
  const pane = { width: 360, height: 300 }
  const view = frameView({
    boxes: column,
    focus: ['e'],
    pane,
    padding,
    direction: 'down',
    floor: 0.79,
    maxZoom: 1,
  })
  for (const box of column) {
    const top = box.y * view.zoom + view.y
    const bottom = top + box.height * view.zoom
    if (bottom <= 0 || top >= pane.height) continue
    expect(top).toBeGreaterThanOrEqual(0)
    expect(bottom).toBeLessThanOrEqual(pane.height)
  }
})

it('leaves forward edges through the bottom when the layers run down', () => {
  const at = (x: number, y: number) => ({ x, y, width: 160, height: 46 })
  expect(pickHandles(at(0, 0), at(0, 120), 'down')).toEqual({
    sourceHandle: 'b',
    targetHandle: 't',
  })
  expect(pickHandles(at(0, 400), at(0, 0), 'down')).toEqual({
    sourceHandle: 'r',
    targetHandle: 'r',
  })
})

it('draws one line per pair of steps, keeping the control edge and a renamed need', () => {
  const edge = (kind: ModelEdge['kind'], label?: string): ModelEdge => ({
    key: `${kind}:a->b`,
    source: 'a',
    target: 'b',
    kind,
    path: [],
    ...(label === undefined ? {} : { label }),
  })
  expect(drawnEdges([edge('needs', 'needs a'), edge('next')])).toEqual([edge('next')])
  expect(drawnEdges([edge('route', 'route'), edge('needs', 'needs input')])).toEqual([
    { ...edge('route'), label: 'needs input' },
  ])
})

it('lays a long, thin graph down the page in a narrow pane and across in a wide one', () => {
  const layout = (direction: 'right' | 'down', width: number, height: number): LayoutResult => ({
    direction,
    placements: { a: { x: 0, y: 0, width, height } },
    routes: {},
    backEdges: new Set(),
    isolated: new Set(),
  })
  const layouts = { right: layout('right', 1000, 46), down: layout('down', 160, 900) }
  const roots = new Set(['a'])
  const pick = (asked: 'auto' | 'right', width: number, height: number) =>
    chooseLayout(asked, layouts, { width, height }, roots).direction
  expect(pick('auto', 1200, 400)).toBe('right')
  expect(pick('auto', 360, 900)).toBe('down')
  expect(pick('right', 360, 900)).toBe('right')
})

it('with autoHeight, asks for the height that shows the whole graph, within its bounds', () => {
  const layout = (direction: 'right' | 'down', width: number, height: number): LayoutResult => ({
    direction,
    placements: { a: { x: 0, y: 0, width, height } },
    routes: {},
    backEdges: new Set(),
    isolated: new Set(),
  })
  const roots = new Set(['a'])
  const short = { right: layout('right', 400, 46), down: layout('down', 160, 300) }
  expect(chooseLayout('auto', short, { width: 700, height: 0 }, roots, true)).toEqual({
    direction: 'right',
    height: 200,
  })
  const tall = { right: layout('right', 1400, 300), down: layout('down', 360, 380) }
  const shape = chooseLayout('auto', tall, { width: 700, height: 0 }, roots, { min: 200, max: 600 })
  expect(shape).toEqual({ direction: 'down', height: 380 + 64 })
})

it('keeps whole steps across the layers too, when a layer is wider than the pane', () => {
  // Two layers; the second holds three cards side by side, wider than a phone.
  const boxes: Box[] = [
    { id: 'top', x: 180, y: 0, width: 160, height: 46 },
    { id: 'l', x: 0, y: 80, width: 160, height: 46 },
    { id: 'm', x: 180, y: 80, width: 160, height: 46 },
    { id: 'r', x: 360, y: 80, width: 160, height: 46 },
  ]
  const pane = { width: 300, height: 300 }
  const view = frameView({
    boxes,
    focus: ['m'],
    pane,
    padding,
    direction: 'down',
    floor: 0.79,
    maxZoom: 1,
  })
  for (const box of boxes) {
    const left = box.x * view.zoom + view.x
    const right = left + box.width * view.zoom
    if (right <= 0 || left >= pane.width) continue
    expect(left).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(pane.width)
  }
  const mLeft = 180 * view.zoom + view.x
  expect(mLeft).toBeGreaterThanOrEqual(0)
})
