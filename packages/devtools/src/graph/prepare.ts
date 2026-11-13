/**
 * What `<WizardGraph>` remembers between mounts, and `prepareGraph`, which fills it ahead of
 * time: the height a graph set for itself, so it opens at that height instead of growing into it.
 *
 * @packageDocumentation
 */

import type { Manifest } from '@openwizard/core/inspect'
import type { LayoutDirection } from '../layout/elk'
import { drawnLabels } from '../layout/merge'
import { buildGraphModel } from '../layout/model'
import { chooseLayout, type GraphAutoHeight, type GraphDirection } from './direction'
import { isNarrow, PAD, READABLE_ZOOM } from './Follow'
import { layoutsFor } from './use-graph-layout'

/** The pane width is rounded to this, so a scrollbar or a sub-pixel change is not a new size. */
export const PANE_GRAIN = 8

const heights = new Map<string, number>()

const heightKey = (graph: Manifest | undefined, autoHeight: GraphAutoHeight | undefined) =>
  `${graph?.name}@${graph?.version}:${JSON.stringify(autoHeight)}`

/** The height this graph last set for itself with these bounds, if it was drawn or prepared. */
export function lastHeight(
  graph: Manifest | undefined,
  autoHeight: GraphAutoHeight | undefined,
): number | undefined {
  return heights.get(heightKey(graph, autoHeight))
}

/** Records the height a graph set for itself. */
export function keepHeight(
  graph: Manifest | undefined,
  autoHeight: GraphAutoHeight | undefined,
  height: number,
): void {
  heights.set(heightKey(graph, autoHeight), height)
}

/**
 * In a narrow pane (a phone), the widest graph drawn at a readable size, in flow pixels, so a
 * wider one is laid out again as narrow as it goes. Rounded so a small resize does not lay out.
 */
export function readableWidth(paneWidth: number): number | undefined {
  if (!isNarrow(paneWidth)) return undefined
  return Math.floor((paneWidth - PAD.left - PAD.right) / READABLE_ZOOM / 16) * 16
}

/** The layout directions to work out for the direction asked for. */
export function directionsFor(asked: GraphDirection): readonly LayoutDirection[] {
  return asked === 'auto' ? BOTH : asked === 'down' ? DOWN : RIGHT
}
const BOTH: readonly LayoutDirection[] = ['right', 'down']
const RIGHT: readonly LayoutDirection[] = ['right']
const DOWN: readonly LayoutDirection[] = ['down']

/**
 * What `prepareGraph` needs to know about the `<WizardGraph>` that will draw the graph: the
 * width of its element in pixels, and the `autoHeight` and `direction` props it will be given.
 * @public
 */
export interface PrepareGraphOptions {
  readonly width: number
  readonly autoHeight?: GraphAutoHeight
  readonly direction?: GraphDirection
}

/**
 * Lays a graph out before a `<WizardGraph>` shows it. A graph that was prepared opens at its
 * final height with its steps in place, where one that was not opens empty and grows a moment
 * later. Call it with `inspect(wizard)` and the width and props the component will have. It uses
 * the default layout engine, and resolves when the layout is ready.
 * @public
 */
export async function prepareGraph(graph: Manifest, options: PrepareGraphOptions): Promise<void> {
  const width = Math.round(options.width / PANE_GRAIN) * PANE_GRAIN
  if (width <= 0) return
  const asked = options.direction ?? 'auto'
  const model = buildGraphModel(graph)
  const layouts = await layoutsFor(
    graph,
    model,
    undefined,
    directionsFor(asked),
    readableWidth(width),
  )
  const roots = new Set(model.nodes.filter((n) => n.parent === undefined).map((n) => n.key))
  const shape = chooseLayout(
    asked,
    layouts,
    { width, height: 0 },
    roots,
    options.autoHeight,
    drawnLabels(model.edges),
  )
  if (shape.height !== undefined) keepHeight(graph, options.autoHeight, shape.height)
}
