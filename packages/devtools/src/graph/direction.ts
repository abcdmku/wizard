/**
 * Which way to lay a graph out in `auto` mode. Layers run down unless running them right draws
 * the graph clearly larger, or the graph is a single row (a short chain) that fits as well
 * across, so wizards of the same shape look alike from page to page.
 *
 * @packageDocumentation
 */

import { type LayoutDirection, type LayoutResult, labelSize } from '../layout/elk'
import { STEP_HEIGHT } from '../layout/model'
import { fitZoom, isNarrow, MAX_FIT_ZOOM, PAD, READABLE_ZOOM } from './Follow'

/**
 * Which way the layers of `<WizardGraph>` run: `right`, `down`, or `auto` to pick the one that
 * draws the graph larger in its pane.
 * @public
 */
export type GraphDirection = LayoutDirection | 'auto'

const NO_LABELS: ReadonlyMap<string, string> = new Map()

/** Right wins a multi-row graph only when it draws it clearly larger. */
const MARGIN = 1.08

/** Zooms this close count as the same: the pane height is rounded to whole pixels. */
const TIE = 0.98

/** A layout no taller than this, laid out right, is one row of cards (labels included). */
const ONE_ROW = STEP_HEIGHT + 32

/**
 * The size of a layout: its root nodes (`roots`: keys of nodes outside any group) and the edge
 * labels (`labels`: the text of each drawn label by edge key), which can stick out past them.
 */
export function extent(
  layout: LayoutResult,
  roots: ReadonlySet<string>,
  labels: ReadonlyMap<string, string> = NO_LABELS,
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
  for (const [key, text] of labels) {
    const at = layout.routes[key]?.label
    if (at === undefined || left === Number.POSITIVE_INFINITY) continue
    const size = labelSize(text)
    left = Math.min(left, at.x - size.width / 2)
    top = Math.min(top, at.y - size.height / 2)
    right = Math.max(right, at.x + size.width / 2)
    bottom = Math.max(bottom, at.y + size.height / 2)
  }
  return left === Number.POSITIVE_INFINITY
    ? { width: 0, height: 0 }
    : { width: right - left, height: bottom - top }
}

/**
 * Lets `<WizardGraph>` set its own height to fit the graph, between `min` and `max` pixels.
 * `true` means 120 to 480, never more than 70% of the window. A graph shorter than `max`
 * gets only the height it needs, down to `min`.
 * @public
 */
export type GraphAutoHeight = boolean | { readonly min: number; readonly max: number }

/** What to draw: the direction, and the height of the pane when the graph sets its own. */
export interface GraphShape {
  readonly direction: LayoutDirection
  readonly height?: number
}

const DEFAULT_HEIGHT = { min: 120, max: 480 } as const
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
  labels: ReadonlyMap<string, string> | undefined,
): { zoom: number; row: boolean; height?: number } {
  const box = extent(layout, roots, labels)
  const row = layout.direction === 'right' && box.height <= ONE_ROW
  if (range === undefined) return { zoom: Math.min(MAX_FIT_ZOOM, fitZoom(box, pane)), row }
  const across = Math.min(MAX_FIT_ZOOM, fitZoom(box, { width: pane.width, height: 1e6 }))
  const padY = PAD.top + PAD.bottom
  // Too wide to read whole in a wide pane: the view will follow the run, so give it the height
  // to show every layer at a readable size. A narrow pane shows the whole graph however small.
  const drawn = isNarrow(pane.width) ? across : Math.max(across, READABLE_ZOOM)
  const height = Math.round(Math.min(range.max, Math.max(range.min, box.height * drawn + padY)))
  return { zoom: Math.min(across, fitZoom(box, { width: pane.width, height })), row, height }
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
  labels?: ReadonlyMap<string, string>,
): GraphShape {
  const range = bounds(autoHeight)
  const measured = pane.width > 0 && (range !== undefined || pane.height > 0)
  const options = (['right', 'down'] as const).flatMap((direction) => {
    const layout = layouts[direction]
    if (layout === undefined || (asked !== 'auto' && asked !== direction)) return []
    return [
      {
        direction,
        ...(measured ? sizeFor(layout, roots, pane, range, labels) : { zoom: 0, row: false }),
      },
    ]
  })
  const [right, down] = [
    options.find((o) => o.direction === 'right'),
    options.find((o) => o.direction === 'down'),
  ]
  const across =
    right !== undefined &&
    (down === undefined ||
      right.zoom > down.zoom * MARGIN ||
      (right.row && right.zoom >= down.zoom * TIE && right.zoom > 0))
  const pick = across ? right : down
  if (pick === undefined) return { direction: asked === 'down' ? 'down' : 'right' }
  return pick.height === undefined
    ? { direction: pick.direction }
    : { direction: pick.direction, height: pick.height }
}
