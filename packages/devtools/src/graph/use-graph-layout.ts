/**
 * `useGraphLayout(graph, engine)` — memoises the model of a `FlowGraph` and runs the (async)
 * ELK layout for it, ignoring stale results when the graph changes mid-flight.
 */

import type { FlowGraph } from '@openwizard/core'
import { useEffect, useMemo, useState } from 'react'
import { type LayoutEngine, type LayoutResult, layoutGraph } from '../layout/elk'
import { buildGraphModel, type GraphModel } from '../layout/model'

export interface GraphLayoutState {
  readonly model: GraphModel | undefined
  readonly layout: LayoutResult | undefined
  /** True while the engine works on the current model. */
  readonly pending: boolean
  readonly error: string | undefined
}

export function useGraphLayout(
  graph: FlowGraph | undefined,
  engine?: LayoutEngine,
): GraphLayoutState {
  const model = useMemo(() => (graph === undefined ? undefined : buildGraphModel(graph)), [graph])
  const [state, setState] = useState<{
    readonly model: GraphModel | undefined
    readonly layout: LayoutResult | undefined
    readonly error: string | undefined
  }>({ model: undefined, layout: undefined, error: undefined })

  useEffect(() => {
    if (model === undefined) return
    let cancelled = false
    layoutGraph(model, engine).then(
      (layout) => {
        if (!cancelled) setState({ model, layout, error: undefined })
      },
      (reason: unknown) => {
        if (!cancelled) setState({ model, layout: undefined, error: describe(reason) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [model, engine])

  const current = state.model === model
  return {
    model,
    layout: current ? state.layout : undefined,
    pending: model !== undefined && !current,
    error: current ? state.error : undefined,
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
