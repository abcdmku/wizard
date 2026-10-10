/**
 * `<FlowGraph>` — the static graph of a flow (`inspect(flow)`) drawn with React Flow after an
 * ELK layered layout, with the live overlay (`statuses`, `activeStep`) and a selection.
 */

import { type FlowGraph as FlowGraphData, inspect } from '@openwizard/core'
import {
  Background,
  Controls,
  type EdgeTypes,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { LayoutEngine } from '../layout/elk'
import type { DevtoolsTheme, GraphInput, GraphSelection, StepStatusMap } from '../types'
import { FlowEdgeComponent } from './FlowEdge'
import { MarkerNodeComponent } from './MarkerNode'
import { GroupNodeComponent, StepNodeComponent } from './StepNode'
import {
  applyOverlay,
  type DevtoolsEdge,
  type DevtoolsNode,
  type GraphOverlay,
  toReactFlow,
} from './to-react-flow'
import { useGraphLayout } from './use-graph-layout'

/**
 * `<FlowGraph>` props: the graph (`graph` from `inspect(flow)`, or `flow`), the live overlay
 * (`statuses` keyed by `stepKey`, `activeStep` = the current view's key), a controlled or
 * uncontrolled selection (`selected` / `onSelect`), the theme and an optional layout engine.
 * @public
 */
export interface FlowGraphProps extends GraphInput {
  /** Key of the current view (`stepKey(path, id)`) — highlighted. */
  readonly activeStep?: string | null
  /** Live statuses / phases by step key (see `collectStatuses`). */
  readonly statuses?: StepStatusMap
  /** Selected step key (controlled). Omit to let the graph keep its own selection. */
  readonly selected?: string | null
  readonly onSelect?: (selection: GraphSelection | null) => void
  readonly theme?: DevtoolsTheme
  /** Custom ELK-compatible layout engine (a worker-backed ELK, a stub in tests). */
  readonly layoutEngine?: LayoutEngine
  /** Show the minimap (default `true`). */
  readonly minimap?: boolean
  readonly className?: string
  readonly style?: CSSProperties
}

const NODE_TYPES: NodeTypes = {
  step: StepNodeComponent,
  group: GroupNodeComponent,
  marker: MarkerNodeComponent,
}
const EDGE_TYPES: EdgeTypes = { flow: FlowEdgeComponent }
const EMPTY_STATUSES: StepStatusMap = {}

/**
 * The static graph of a flow, laid out with ELK (left → right layers; cycles broken for the
 * layout and drawn as U-turns; nodes no edge touches parked in a right-hand column; child flows
 * as group nodes) with the live overlay when `statuses` / `activeStep` are given. Click a step
 * to select it (`onSelect`), the pane to clear.
 * @public
 */
export function FlowGraph(props: FlowGraphProps): ReactElement {
  const graph: FlowGraphData | undefined = useMemo(
    () => props.graph ?? (props.flow === undefined ? undefined : inspect(props.flow)),
    [props.graph, props.flow],
  )
  const { model, layout, pending, error } = useGraphLayout(graph, props.layoutEngine)
  const [ownSelected, setOwnSelected] = useState<string | null>(null)
  const selected = props.selected === undefined ? ownSelected : props.selected
  const overlay: GraphOverlay = useMemo(
    () => ({
      statuses: props.statuses ?? EMPTY_STATUSES,
      current: props.activeStep ?? null,
      selected,
    }),
    [props.statuses, props.activeStep, selected],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<DevtoolsNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<DevtoolsEdge>([])
  const latestOverlay = useRef(overlay)
  latestOverlay.current = overlay

  // A new layout replaces everything (seeded with the latest overlay); an overlay change only
  // refreshes `data`, so positions the user dragged stay.
  useEffect(() => {
    if (model === undefined || layout === undefined) return
    const built = toReactFlow(model, layout, latestOverlay.current)
    setNodes(built.nodes)
    setEdges(built.edges)
  }, [model, layout, setNodes, setEdges])
  useEffect(() => {
    setNodes((current) => applyOverlay(current, overlay))
  }, [overlay, setNodes])

  const { onSelect } = props
  const select = useCallback(
    (selection: GraphSelection | null) => {
      setOwnSelected(selection?.key ?? null)
      onSelect?.(selection)
    },
    [onSelect],
  )
  const onNodeClick: NodeMouseHandler<DevtoolsNode> = useCallback(
    (_event, node) => {
      if (node.type === 'marker') return
      select({ id: node.data.step.id, path: node.data.path, key: node.id })
    },
    [select],
  )
  const onPaneClick = useCallback(() => select(null), [select])

  const theme = props.theme ?? 'system'
  return (
    <div
      className={
        props.className === undefined ? 'owd owd-graph' : `owd owd-graph ${props.className}`
      }
      data-theme={theme === 'system' ? undefined : theme}
      style={props.style}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        className="owd-flow"
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        {props.minimap !== false && <MiniMap pannable zoomable className="owd-minimap" />}
        <Panel position="top-left">
          <div className="owd-toolbar">
            <span className="owd-title">
              {graph === undefined ? 'no flow' : `${graph.name} v${graph.version}`}
            </span>
            {graph !== undefined && graph.warnings.length > 0 && (
              <span
                className="owd-badge owd-badge-warn"
                title={graph.warnings.map((w) => w.message).join('\n')}
              >
                ⚠ {graph.warnings.length} warning{graph.warnings.length === 1 ? '' : 's'}
              </span>
            )}
            {pending && <span className="owd-badge">layout…</span>}
            {error !== undefined && (
              <span className="owd-badge owd-badge-danger" title={error}>
                layout failed
              </span>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
