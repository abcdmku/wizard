/**
 * `useGraphLayout(graph, engine, directions, fitWidth)` — memoises the model of a `Manifest` and
 * runs the (async) ELK layout for it once per direction asked for, ignoring stale results when
 * the graph changes mid-flight. With `fitWidth` (a narrow pane), a top-to-bottom layout wider
 * than that is laid out again as narrow as ELK can, and the narrower of the two is kept.
 */

import type { Manifest } from '@openwizard/core/inspect'
import { useEffect, useMemo, useState } from 'react'
import {
  type LayoutDirection,
  type LayoutEngine,
  type LayoutResult,
  layoutWith,
} from '../layout/elk'
import { drawnLabels } from '../layout/merge'
import { buildGraphModel, type GraphModel } from '../layout/model'
import { extent } from './direction'

/** Layouts by direction. */
export type Layouts = Partial<Record<LayoutDirection, LayoutResult>>

interface GraphLayoutState {
  readonly model: GraphModel | undefined
  /** One layout per direction asked for, once all of them are done. */
  readonly layouts: Layouts | undefined
  /** True while the engine works on the current model. */
  readonly pending: boolean
  readonly error: string | undefined
}

export function useGraphLayout(
  graph: Manifest | undefined,
  engine: LayoutEngine | undefined,
  directions: readonly LayoutDirection[],
  fitWidth?: number,
): GraphLayoutState {
  const model = useMemo(() => (graph === undefined ? undefined : buildGraphModel(graph)), [graph])
  const asked = `${directions.join(',')}${fitWidth === undefined ? '' : `:${fitWidth}`}`
  const [state, setState] = useState<{
    readonly model: GraphModel | undefined
    readonly asked: string
    readonly layouts: Layouts | undefined
    readonly error: string | undefined
  }>({ model: undefined, asked: '', layouts: undefined, error: undefined })

  useEffect(() => {
    if (model === undefined) return
    let cancelled = false
    const [list = '', width] = asked.split(':')
    const wanted = list.split(',') as LayoutDirection[]
    const fit = width === undefined ? undefined : Number(width)
    Promise.all(wanted.map((direction) => layOut(model, engine, direction, fit))).then(
      (results) => {
        if (cancelled) return
        const layouts: Layouts = {}
        for (const result of results) layouts[result.direction] = result
        setState({ model, asked, layouts, error: undefined })
      },
      (reason: unknown) => {
        if (!cancelled) setState({ model, asked, layouts: undefined, error: describe(reason) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [model, engine, asked])

  const current = state.model === model && state.asked === asked
  return {
    model,
    layouts: current ? state.layouts : undefined,
    pending: model !== undefined && !current,
    error: current ? state.error : undefined,
  }
}

/** The layout, and in a narrow pane the narrower one when it is wider than `fitWidth`. */
async function layOut(
  model: GraphModel,
  engine: LayoutEngine | undefined,
  direction: LayoutDirection,
  fitWidth: number | undefined,
): Promise<LayoutResult> {
  const first = await layoutWith(model, engine, direction, false)
  if (fitWidth === undefined || direction !== 'down') return first
  const roots = new Set(model.nodes.filter((n) => n.parent === undefined).map((n) => n.key))
  const labels = drawnLabels(model.edges)
  const width = (layout: LayoutResult) => extent(layout, roots, labels).width
  if (width(first) <= fitWidth) return first
  const narrow = await layoutWith(model, engine, direction, true)
  return width(narrow) < width(first) ? narrow : first
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
