/**
 * Which way to lay a graph out in `auto` mode: the direction that draws it larger in the pane
 * it has, so a wide pane gets layers running right and a narrow or tall one layers running down.
 *
 * @packageDocumentation
 */

import type { LayoutDirection, LayoutResult } from '../layout/elk'
import { fitZoom, MAX_FIT_ZOOM, PAD, READABLE_ZOOM } from './Follow'

/**
 * Which way the layers of `<WizardGraph>` run: `right`, `down`, or `auto` to pick the one that
 * draws the graph larger in its pane.
 * @public
 */
export type GraphDirection = LayoutDirection | 'auto'

/** Down wins only when it draws the graph clearly larger, so a near tie keeps the usual right. */
const MARGIN = 1.08

/** The size of the root nodes (`roots`: keys of nodes outside any group) of a layout. */
function extent(
  layout: LayoutResult,
  roots: ReadonlySet<string>,
): { width: number; height: number } {
  let right = 0
  let bottom = 0
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const [key, p] of Object.entries(layout.placements)) {
    if (!roots.has(key)) continue
    left = Math.min(left, p.x)
    top = Math.min(top, p.y)
    right = Math.max(right, p.x + p.width)
    bottom = Math.max(bottom, p.y + p.height)
  }
  return left === Number.POSITIVE_INFINITY
    ? { width: 0, height: 0 }
    : { width: right - left, height: bottom - top }
}

/**
 * Lets `<WizardGraph>` set its own height to fit the graph, between `min` and `max` pixels.
 * `true` means 200 to 480, never more than 70% of the window.
 * @public
 */
export type GraphAutoHeight = boolean | { readonly min: number; readonly max: number }

/** What to draw: the direction, and the height of the pane when the graph sets its own. */
export interface GraphShape {
  readonly direction: LayoutDirection
  readonly height?: number
}

const DEFAULT_HEIGHT = { min: 200, max: 480 } as const
const WINDOW_SHARE = 0.7

function bounds(autoHeight: GraphAutoHeight | undefined): { min: number; max: number } | undefined {
  if (autoHeight === undefined || autoHeight === false) return undefined
  const asked = autoHeight === true ? DEFAULT_HEIGHT : autoHeight
  const screen = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight
  const max = Math.max(asked.min, Math.min(asked.max, screen * WINDOW_SHARE))
  return { min: asked.min, max }
}

/** The zoom a layout gets, and the pane height it wants when the graph sets its own. */
function sizeFor(
  layout: LayoutResult,
  roots: ReadonlySet<string>,
  pane: { readonly width: number; readonly height: number },
  range: { min: number; max: number } | undefined,
): { zoom: number; height?: number } {
  const box = extent(layout, roots)
  if (range === undefined) return { zoom: Math.min(MAX_FIT_ZOOM, fitZoom(box, pane)) }
  const across = Math.min(MAX_FIT_ZOOM, fitZoom(box, { width: pane.width, height: 1e6 }))
  const padY = PAD.top + PAD.bottom
  // Too wide to read whole: the view will follow the run, so give it the height to show every
  // layer at a readable size.
  const drawn = Math.max(across, READABLE_ZOOM)
  const height = Math.round(Math.min(range.max, Math.max(range.min, box.height * drawn + padY)))
  return { zoom: Math.min(across, fitZoom(box, { width: pane.width, height })), height }
}

/**
 * The direction to draw (the one asked for, or in `auto` the one that draws the graph larger)
 * and, with `autoHeight`, the pane height that shows it best.
 */
export function chooseLayout(
  asked: GraphDirection,
  layouts: Partial<Record<LayoutDirection, LayoutResult>>,
  pane: { readonly width: number; readonly height: number },
  roots: ReadonlySet<string>,
  autoHeight?: GraphAutoHeight,
): GraphShape {
  const range = bounds(autoHeight)
  const measured = pane.width > 0 && (range !== undefined || pane.height > 0)
  const options = (['right', 'down'] as const).flatMap((direction) => {
    const layout = layouts[direction]
    if (layout === undefined || (asked !== 'auto' && asked !== direction)) return []
    return [{ direction, ...(measured ? sizeFor(layout, roots, pane, range) : { zoom: 0 }) }]
  })
  const [right, down] = [
    options.find((o) => o.direction === 'right'),
    options.find((o) => o.direction === 'down'),
  ]
  const pick =
    right === undefined || (down !== undefined && down.zoom > right.zoom * MARGIN) ? down : right
  if (pick === undefined) return { direction: asked === 'down' ? 'down' : 'right' }
  return pick.height === undefined
    ? { direction: pick.direction }
    : { direction: pick.direction, height: pick.height }
}
