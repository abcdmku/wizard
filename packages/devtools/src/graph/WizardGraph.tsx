/**
 * `<WizardGraph>` — the static graph of a wizard (`inspect(wizard)`) drawn with React Flow after an
 * ELK layered layout, with the live overlay (`statuses`, `activeStep`) and a selection.
 */

import { inspect, type Manifest } from '@openwizard/core/inspect'
import {
  Background,
  Controls,
  type EdgeTypes,
  MiniMap,
  type NodeMouseHandler,
  type NodeTypes,
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
import type { LayoutDirection, LayoutEngine } from '../layout/elk'
import type { DevtoolsTheme, GraphInput, GraphSelection, StepStatusMap } from '../types'
import { chooseLayout, type GraphAutoHeight, type GraphDirection } from './direction'
import { EdgeHints } from './EdgeHints'
import { FIT_PADDING, Follow, MAX_FIT_ZOOM } from './Follow'
import { GraphEdgeComponent } from './GraphEdge'
import { definitionPath, instanceGraph } from './instances'
import { Keyboard } from './Keyboard'
import { MarkerNodeComponent } from './MarkerNode'
import { GroupNodeComponent, StepNodeComponent } from './StepNode'
import {
  applyEdgeOverlay,
  applyOverlay,
  type DevtoolsEdge,
  type DevtoolsNode,
  type GraphOverlay,
  toReactFlow,
} from './to-react-flow'
import { useGraphLayout } from './use-graph-layout'
import { usePaneSize } from './use-pane-size'

/**
 * `<WizardGraph>` props: the graph (`graph` from `inspect(wizard)`, or `wizard`), the live overlay
 * (`statuses` keyed by `stepKey`, `activeStep` = the current view's key), a controlled or
 * uncontrolled selection (`selected` / `onSelect`), the theme and an optional layout engine.
 * @public
 */
export interface WizardGraphProps extends GraphInput {
  /** Key of the current view (`stepKey(path, id)`) — highlighted. */
  readonly activeStep?: string | null
  /** Live statuses / phases by step key (see `collectStatuses`). */
  readonly statuses?: StepStatusMap
  /** Live child run paths from collectStatuses(). Mapped children get one group per index. */
  readonly childPaths?: readonly (readonly string[])[]
  /** Selected step key (controlled). Omit to let the graph keep its own selection. */
  readonly selected?: string | null
  readonly onSelect?: (selection: GraphSelection | null) => void
  readonly theme?: DevtoolsTheme
  /** Custom ELK-compatible layout engine (a worker-backed ELK, a stub in tests). */
  readonly layoutEngine?: LayoutEngine
  /**
   * Keep the graph readable: a graph too wide to read whole is drawn larger, centred on the
   * steps that are running, waiting or failed, and the view moves as the run does.
   */
  readonly follow?: boolean
  /** Show the minimap (default `true`). */
  readonly minimap?: boolean
  /**
   * Which way the layers run: `right` (first step on the left), `down` (first step on top), or
   * `auto` (default) to pick the one that draws the graph larger in its pane, so a narrow pane
   * gets a top-to-bottom graph.
   */
  readonly direction?: GraphDirection
  /**
   * Let the graph set its own height to show the whole wizard at a readable size: `true` for
   * 200 to 480 pixels (at most 70% of the window), or `{ min, max }`. The width still comes
   * from the container. Omit it to fill the container's height.
   */
  readonly autoHeight?: GraphAutoHeight
  /**
   * Keys (`stepKey(path, id)`) of the steps that wait on a person, such as a form to fill in or a
   * service call to answer by hand. Each of them shows `waiting on you`, whatever its engine
   * status. When omitted, a form step that waits for input shows `waiting on you` and every
   * other waiting step shows `waiting`.
   */
  readonly attention?: readonly string[]
  /**
   * Zoom with the mouse wheel (default `true`). Pass `false` for a graph inside a scrolling
   * page: the wheel then scrolls the page, and pinch or Ctrl with the wheel still zooms.
   */
  readonly wheelZoom?: boolean
  readonly className?: string
  readonly style?: CSSProperties
}

const NODE_TYPES: NodeTypes = {
  step: StepNodeComponent,
  group: GroupNodeComponent,
  marker: MarkerNodeComponent,
}
const EDGE_TYPES: EdgeTypes = { graph: GraphEdgeComponent }
const EMPTY_STATUSES: StepStatusMap = {}
const BOTH: readonly LayoutDirection[] = ['right', 'down']
const RIGHT: readonly LayoutDirection[] = ['right']
const DOWN: readonly LayoutDirection[] = ['down']

/**
 * The static graph of a wizard, laid out with ELK (layers running right or down, picked for the
 * pane by default; cycles broken for the layout and drawn as U-turns; child wizards as group
 * nodes) with the live overlay when `statuses` / `activeStep` are given. Click a step, or focus
 * it and press Enter, to select it (`onSelect`); click the pane to clear.
 * @public
 */
export function WizardGraph(props: WizardGraphProps): ReactElement {
  const definition: Manifest | undefined = useMemo(
    () => props.graph ?? (props.wizard === undefined ? undefined : inspect(props.wizard)),
    [props.graph, props.wizard],
  )
  const paths = props.childPaths ?? []
  const pathKey = JSON.stringify(paths)
  const lastPaths = useRef({ key: pathKey, paths })
  if (lastPaths.current.key !== pathKey) lastPaths.current = { key: pathKey, paths }
  const stablePaths = lastPaths.current.paths
  const graph = useMemo(
    () => (definition === undefined ? undefined : instanceGraph(definition, stablePaths)),
    [definition, stablePaths],
  )
  const asked = props.direction ?? 'auto'
  const directions = asked === 'auto' ? BOTH : asked === 'down' ? DOWN : RIGHT
  const { model, layouts, pending, error } = useGraphLayout(graph, props.layoutEngine, directions)
  const paneRef = useRef<HTMLDivElement>(null)
  const pane = usePaneSize(paneRef)
  const roots = useMemo(
    () => new Set(model?.nodes.filter((n) => n.parent === undefined).map((n) => n.key)),
    [model],
  )
  const shape =
    layouts === undefined ? undefined : chooseLayout(asked, layouts, pane, roots, props.autoHeight)
  const direction = shape?.direction ?? 'right'
  const autoHeight = props.autoHeight !== undefined && props.autoHeight !== false
  const layout = layouts?.[direction]
  const [ownSelected, setOwnSelected] = useState<string | null>(null)
  const selected = props.selected === undefined ? ownSelected : props.selected
  const attentionKey = props.attention?.join('\n')
  const attention = useMemo(
    () => (attentionKey === undefined ? undefined : new Set(attentionKey.split('\n'))),
    [attentionKey],
  )
  const overlay: GraphOverlay = useMemo(
    () => ({
      statuses: props.statuses ?? EMPTY_STATUSES,
      current: props.activeStep ?? null,
      selected,
      ...(attention === undefined ? {} : { attention }),
    }),
    [props.statuses, props.activeStep, selected, attention],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<DevtoolsNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<DevtoolsEdge>([])
  const latestOverlay = useRef(overlay)
  latestOverlay.current = overlay

  // A new layout replaces everything (seeded with the latest overlay); an overlay change only
  // refreshes `data`, so positions the user dragged stay.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (model === undefined || layout === undefined) return
    const built = toReactFlow(model, layout, latestOverlay.current)
    setNodes(built.nodes)
    setEdges(built.edges)
    setRevision((n) => n + 1)
  }, [model, layout, setNodes, setEdges])
  useEffect(() => {
    setNodes((current) => applyOverlay(current, overlay))
    setEdges((current) => applyEdgeOverlay(current, overlay))
  }, [overlay, setNodes, setEdges])

  const { onSelect } = props
  const select = useCallback(
    (selection: GraphSelection | null) => {
      setOwnSelected(selection?.key ?? null)
      onSelect?.(selection)
    },
    [onSelect],
  )
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const selectNode = useCallback(
    (node: DevtoolsNode) => {
      if (node.type === 'marker') return
      if (
        stablePaths.length > 0 &&
        definition !== undefined &&
        definitionPath(definition, node.data.path) === undefined
      )
        return
      select({ id: node.data.step.id, path: node.data.path, key: node.id })
    },
    [definition, stablePaths, select],
  )
  const onNodeClick: NodeMouseHandler<DevtoolsNode> = useCallback(
    (_event, node) => selectNode(node),
    [selectNode],
  )
  const onNodeKey = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (node !== undefined) selectNode(node)
    },
    [selectNode],
  )
  const onPaneClick = useCallback(() => select(null), [select])

  const theme = props.theme ?? 'system'
  const wheelZoom = props.wheelZoom !== false
  const toolbar = (
    <>
      <span className="owd-title">
        {graph === undefined ? 'no wizard' : `${graph.name} v${graph.version}`}
      </span>
      {graph !== undefined && graph.warnings.length > 0 && (
        <span
          className="owd-badge owd-badge-warn"
          title={graph.warnings.map((w) => w.message).join('\n')}
        >
          {graph.warnings.length} warning{graph.warnings.length === 1 ? '' : 's'}
        </span>
      )}
      {pending && <span className="owd-badge">Laying out</span>}
      {error !== undefined && (
        <span className="owd-badge owd-badge-danger" title={error}>
          Layout failed
        </span>
      )}
    </>
  )
  return (
    <div
      ref={paneRef}
      className={
        props.className === undefined ? 'owd owd-graph' : `owd owd-graph ${props.className}`
      }
      data-theme={theme === 'system' ? undefined : theme}
      data-direction={direction}
      data-auto-height={autoHeight ? '' : undefined}
      style={
        autoHeight && shape?.height !== undefined
          ? { ...props.style, height: shape.height }
          : props.style
      }
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
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM }}
        minZoom={0.1}
        zoomOnScroll={wheelZoom}
        preventScrolling={wheelZoom}
        autoPanOnNodeFocus={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        className="owd-canvas"
      >
        {props.follow === true && (
          <Follow statuses={overlay.statuses} direction={direction} revision={revision} />
        )}
        <Keyboard onSelect={onNodeKey} />
        <Background gap={24} />
        <Controls
          showInteractive={false}
          position="top-right"
          orientation="horizontal"
          className="owd-controls"
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM }}
        />
        {props.minimap !== false && <MiniMap pannable zoomable className="owd-minimap" />}
        <EdgeHints toolbar={toolbar} />
      </ReactFlow>
    </div>
  )
}
