/**
 * `<WizardGraph>` — the static graph of a wizard (`inspect(wizard)`) drawn with React Flow after an
 * ELK layered layout, with the live overlay (`statuses`, `activeStep`) and a selection.
 */

import { inspect, type Manifest } from '@openwizard/core/inspect'
import {
  Background,
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
import { drawnLabels } from '../layout/merge'
import type { DevtoolsTheme, GraphInput, GraphSelection, StepStatusMap } from '../types'
import { chooseLayout, type GraphAutoHeight, type GraphDirection } from './direction'
import { EdgeHints } from './EdgeHints'
import { GraphControls } from './Fit'
import { FIT_PADDING, FitWhole, Follow, isNarrow, MAX_FIT_ZOOM, PAD, READABLE_ZOOM } from './Follow'
import { GraphEdgeComponent } from './GraphEdge'
import { definitionPath, instanceGraph } from './instances'
import { Keyboard } from './Keyboard'
import { MarkerNodeComponent } from './MarkerNode'
import { closedSteps } from './paths'
import { GroupNodeComponent, StepNodeComponent } from './StepNode'
import {
  applyEdgeOverlay,
  applyOverlay,
  type DevtoolsEdge,
  type DevtoolsNode,
  type GraphOverlay,
  type NotRunReason,
  toReactFlow,
} from './to-react-flow'
import { useGraphLayout } from './use-graph-layout'
import { usePaneSize } from './use-pane-size'
import { WheelZoom } from './WheelZoom'

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
   * service call to answer by hand. Each of them shows `waiting on you` while it runs or waits,
   * and a ring when it is undoing, done or failed, since those keep their own word. When
   * omitted, a form step that waits for input shows `waiting on you` and every other waiting
   * step shows `waiting`.
   */
  readonly attention?: readonly string[]
  /**
   * The run has ended (done, failed, cancelled or undone). A step it never started then shows
   * `not run` instead of `blocked`. Default `false`.
   */
  readonly ended?: boolean
  /**
   * The run's status (`run.status`, such as `running`, `compensating` or `failed`). While the
   * run is undoing, or once it has stopped, a step it never started shows `not run` instead of
   * `blocked`, as `ended` does. Omit it to rely on `ended` alone.
   */
  readonly runStatus?: string
  /**
   * Show the small React Flow link in the corner (default `true`). Pass `false` only when you
   * credit React Flow elsewhere.
   */
  readonly attribution?: boolean
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
/**
 * In a narrow pane (a phone), the widest graph drawn at a readable size, in flow pixels, so a
 * wider one is laid out again as narrow as it goes. Rounded so a small resize does not lay out.
 */
function readableWidth(paneWidth: number): number | undefined {
  if (!isNarrow(paneWidth)) return undefined
  return Math.floor((paneWidth - PAD.left - PAD.right) / READABLE_ZOOM / 16) * 16
}

/** Run statuses after which no step that has not started will start. */
const STOPPED = new Set(['done', 'failed', 'cancelled', 'halted', 'compensated'])

function stoppedBy(props: WizardGraphProps): Exclude<NotRunReason, 'closed'> | undefined {
  if (props.runStatus === 'compensating') return 'undoing'
  return props.ended === true || STOPPED.has(props.runStatus ?? '') ? 'ended' : undefined
}
const BOTH: readonly LayoutDirection[] = ['right', 'down']
const RIGHT: readonly LayoutDirection[] = ['right']
const DOWN: readonly LayoutDirection[] = ['down']
/** The height of a graph that sets its own while its layout is worked out. */
const PENDING_HEIGHT = 160
/** How far the measured pane may be from the height asked for (`usePaneSize` rounds to 8px). */
const SIZE_GRAIN = 8

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
  const paneRef = useRef<HTMLDivElement>(null)
  const pane = usePaneSize(paneRef)
  const { model, layouts, pending, error } = useGraphLayout(
    graph,
    props.layoutEngine,
    directions,
    readableWidth(pane.width),
  )
  const roots = useMemo(
    () => new Set(model?.nodes.filter((n) => n.parent === undefined).map((n) => n.key)),
    [model],
  )
  const labels = useMemo(() => drawnLabels(model?.edges ?? []), [model])
  const shape =
    layouts === undefined
      ? undefined
      : chooseLayout(asked, layouts, pane, roots, props.autoHeight, labels)
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
  const statuses = props.statuses ?? EMPTY_STATUSES
  const stopped = stoppedBy(props)
  const closed = useMemo(
    () => (model === undefined ? undefined : closedSteps(model.edges, statuses)),
    [model, statuses],
  )
  const overlay: GraphOverlay = useMemo(
    () => ({
      statuses,
      current: props.activeStep ?? null,
      selected,
      ...(attention === undefined ? {} : { attention }),
      ...(stopped === undefined ? {} : { stopped }),
      ...(closed === undefined ? {} : { closed }),
    }),
    [statuses, props.activeStep, selected, attention, stopped, closed],
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
  const height = autoHeight ? (shape?.height ?? PENDING_HEIGHT) : undefined
  // React Flow needs a sized parent: wait until the pane has its size (with `autoHeight`, the
  // one the graph asked for), so the first view is not fitted to a pane about to change.
  const sized =
    pane.width > 0 &&
    pane.height > 0 &&
    (!autoHeight ||
      (shape?.height !== undefined && Math.abs(pane.height - shape.height) <= SIZE_GRAIN))
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
      style={height === undefined ? props.style : { ...props.style, height }}
    >
      {sized && (
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
          proOptions={{ hideAttribution: props.attribution === false }}
          className="owd-canvas"
        >
          {props.follow === true ? (
            <Follow statuses={overlay.statuses} direction={direction} revision={revision} />
          ) : (
            <FitWhole revision={revision} />
          )}
          <Keyboard onSelect={onNodeKey} onClear={onPaneClick} />
          <WheelZoom />
          <Background gap={24} />
          <GraphControls />
          {props.minimap !== false && <MiniMap pannable zoomable className="owd-minimap" />}
          <EdgeHints toolbar={toolbar} />
        </ReactFlow>
      )}
    </div>
  )
}
