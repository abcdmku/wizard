/**
 * `useGraphLayout(graph, engine, directions)` — memoises the model of a `Manifest` and runs the
 * (async) ELK layout for it once per direction asked for, ignoring stale results when the graph
 * changes mid-flight.
 */

import type { Manifest } from '@openwizard/core/inspect'
import { useEffect, useMemo, useState } from 'react'
import {
  type LayoutDirection,
  type LayoutEngine,
  type LayoutResult,
  layoutGraph,
} from '../layout/elk'
import { buildGraphModel, type GraphModel } from '../layout/model'

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
): GraphLayoutState {
  const model = useMemo(() => (graph === undefined ? undefined : buildGraphModel(graph)), [graph])
  const asked = directions.join(',')
  const [state, setState] = useState<{
    readonly model: GraphModel | undefined
    readonly asked: string
    readonly layouts: Layouts | undefined
    readonly error: string | undefined
  }>({ model: undefined, asked: '', layouts: undefined, error: undefined })

  useEffect(() => {
    if (model === undefined) return
    let cancelled = false
    const wanted = asked.split(',') as LayoutDirection[]
    Promise.all(wanted.map((direction) => layoutGraph(model, engine, { direction }))).then(
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

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
