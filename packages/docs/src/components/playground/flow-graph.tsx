import type { FlowGraph, StepStatus } from '@openwizard/core'
import { useMemo } from 'react'
import {
  type DagLayout,
  type FlowGraphNode,
  flowsOf,
  type LaidOutEdge,
  type LaidOutNode,
  layoutFlow,
} from './dag-layout'

export interface NodeLiveState {
  readonly status: StepStatus
  readonly phase?: string
}

export type NodeStateLookup = (path: readonly string[], id: string) => NodeLiveState | undefined

interface FlowGraphViewProps {
  readonly graph: FlowGraph
  readonly liveState?: NodeStateLookup | undefined
  readonly selected?: { readonly path: readonly string[]; readonly id: string } | null | undefined
  readonly onSelect?: ((path: readonly string[], id: string) => void) | undefined
}

const KIND_GLYPH: Record<FlowGraphNode['kind'], string> = {
  view: '▭',
  task: '⚙',
  wait: '◷',
  decision: '◇',
  flow: '▣',
  final: '◎',
}

function edgePath({ from, to, back }: LaidOutEdge): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  if (!back) {
    const bend = Math.max(18, (y2 - y1) / 2)
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
  }
  // Loop out to the right of both nodes and back into the top of the target.
  const right = Math.max(from.x + from.width, to.x + to.width) + 26
  const sx = from.x + from.width
  const sy = from.y + from.height / 2
  return `M ${sx} ${sy} C ${right} ${sy}, ${right} ${y2 - 30}, ${x2 + to.width / 4} ${y2}`
}

const formatMs = (ms: number): string =>
  ms % 3_600_000 === 0
    ? `${ms / 3_600_000}h`
    : ms % 60_000 === 0
      ? `${ms / 60_000}m`
      : ms % 1000 === 0
        ? `${ms / 1000}s`
        : `${ms}ms`

function edgeLabel({ edge, from, to }: LaidOutEdge): string | null {
  if (edge.kind === 'dependsOn') {
    const spec = to.node.dependsOn
    return spec && 'any' in spec ? 'dependsOn (any)' : 'dependsOn'
  }
  if (edge.kind === 'timeout') {
    return from.node.timeout === undefined ? 'timeout' : `timeout ${formatMs(from.node.timeout)}`
  }
  return null
}

function nodeClasses(state: NodeLiveState | undefined, isSelected: boolean): string {
  const status = state?.status ?? 'idle'
  const base = 'cursor-pointer transition-colors'
  const fill =
    status === 'done'
      ? 'fill-neutral-900 dark:fill-neutral-100'
      : status === 'active'
        ? 'fill-white dark:fill-neutral-900'
        : 'fill-white dark:fill-ink-2'
  const stroke =
    status === 'active'
      ? 'stroke-neutral-900 dark:stroke-neutral-100 [stroke-width:2]'
      : status === 'failed'
        ? 'stroke-neutral-900 dark:stroke-neutral-100 [stroke-dasharray:4_3] [stroke-width:1.5]'
        : status === 'skipped' || status === 'cancelled'
          ? 'stroke-neutral-400 dark:stroke-neutral-600 [stroke-dasharray:2_3]'
          : 'stroke-neutral-400 dark:stroke-neutral-600'
  const ring = isSelected ? 'drop-shadow-[0_0_0_3px_rgba(120,120,120,0.35)]' : ''
  return `${base} ${fill} ${stroke} ${ring}`
}

function textClasses(state: NodeLiveState | undefined): string {
  return state?.status === 'done'
    ? 'fill-white dark:fill-neutral-900'
    : state?.status === 'skipped' || state?.status === 'cancelled'
      ? 'fill-neutral-400 dark:fill-neutral-500'
      : 'fill-neutral-900 dark:fill-neutral-100'
}

function NodeShape({
  node,
  className,
}: {
  readonly node: LaidOutNode
  readonly className: string
}) {
  const { x, y, width: w, height: h } = node
  switch (node.node.kind) {
    case 'wait':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} className={className} />
    case 'decision':
      return (
        <polygon
          points={`${x + 12},${y} ${x + w - 12},${y} ${x + w},${y + h / 2} ${x + w - 12},${y + h} ${x + 12},${y + h} ${x},${y + h / 2}`}
          className={className}
        />
      )
    case 'flow':
      return (
        <polygon
          points={`${x + 10},${y} ${x + w},${y} ${x + w - 10},${y + h} ${x},${y + h}`}
          className={className}
        />
      )
    case 'final':
      return (
        <>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} className={className} />
          <rect
            x={x + 3}
            y={y + 3}
            width={w - 6}
            height={h - 6}
            rx={(h - 6) / 2}
            className="fill-none stroke-current stroke-neutral-400 dark:stroke-neutral-600"
          />
        </>
      )
    case 'task':
      return (
        <>
          <rect x={x} y={y} width={w} height={h} rx={4} className={className} />
          <line
            x1={x + 6}
            y1={y}
            x2={x + 6}
            y2={y + h}
            className="stroke-neutral-400 dark:stroke-neutral-600"
          />
          <line
            x1={x + w - 6}
            y1={y}
            x2={x + w - 6}
            y2={y + h}
            className="stroke-neutral-400 dark:stroke-neutral-600"
          />
        </>
      )
    default:
      return <rect x={x} y={y} width={w} height={h} rx={8} className={className} />
  }
}

function FlowSvg({
  layout,
  path,
  liveState,
  selected,
  onSelect,
}: {
  readonly layout: DagLayout
  readonly path: readonly string[]
} & Pick<FlowGraphViewProps, 'liveState' | 'selected' | 'onSelect'>) {
  const markerId = `arrow-${path.join('-') || 'root'}`
  const isSelected = (id: string) =>
    selected !== null &&
    selected !== undefined &&
    selected.id === id &&
    selected.path.join('/') === path.join('/')
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
      height={layout.height}
      className="block max-w-full font-mono text-[11px]"
      style={{ height: 'auto' }}
      role="img"
      aria-label="Flow graph"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-neutral-500 dark:fill-neutral-400" />
        </marker>
      </defs>
      {layout.edges.map((laid) => {
        const label = edgeLabel(laid)
        const dashed = laid.edge.kind === 'timeout' || laid.edge.kind === 'dependsOn'
        const midX = (laid.from.x + laid.from.width / 2 + laid.to.x + laid.to.width / 2) / 2
        const midY = (laid.from.y + laid.from.height + laid.to.y) / 2
        return (
          <g key={`${laid.edge.from}-${laid.edge.to}-${laid.edge.kind}`}>
            <path
              d={edgePath(laid)}
              fill="none"
              markerEnd={`url(#${markerId})`}
              className={`stroke-neutral-500 dark:stroke-neutral-400 ${dashed ? '[stroke-dasharray:4_3]' : ''}`}
              strokeWidth={1.2}
            />
            {label && (
              <text
                x={midX + 6}
                y={midY}
                className="fill-neutral-500 text-[9.5px]"
                dominantBaseline="middle"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}
      {layout.nodes.map((laid) => {
        const state = liveState?.(path, laid.node.id)
        const detail = state?.phase ?? (state && state.status !== 'idle' ? state.status : null)
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG node group is the clickable target here
          <g
            key={laid.node.id}
            role="button"
            tabIndex={0}
            aria-label={`${laid.node.id} (${laid.node.kind})`}
            onClick={() => onSelect?.(path, laid.node.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect?.(path, laid.node.id)
            }}
          >
            <NodeShape node={laid} className={nodeClasses(state, isSelected(laid.node.id))} />
            <text
              x={laid.x + laid.width / 2}
              y={laid.y + (detail ? 17 : laid.height / 2)}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`${textClasses(state)} text-[11.5px] font-medium`}
            >
              <tspan className="opacity-60">{KIND_GLYPH[laid.node.kind]} </tspan>
              {laid.node.id}
            </text>
            {detail && (
              <text
                x={laid.x + laid.width / 2}
                y={laid.y + 32}
                textAnchor="middle"
                dominantBaseline="middle"
                className={`${textClasses(state)} text-[9.5px] opacity-70`}
              >
                {detail}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Every flow of the graph (root first, then each child flow) as a stacked set of SVG DAGs. */
export function FlowGraphView({ graph, liveState, selected, onSelect }: FlowGraphViewProps) {
  const flows = useMemo(
    () => flowsOf(graph).map((flow) => ({ ...flow, layout: layoutFlow(flow.nodes, flow.edges) })),
    [graph],
  )
  return (
    <div className="flex flex-col gap-6">
      {flows.map((flow) => (
        <section key={flow.path.join('/') || 'root'} className="flex flex-col items-center gap-2">
          <h4 className="self-start font-mono text-[11px] text-neutral-500">
            {flow.path.length === 0
              ? `${graph.name} v${graph.version}`
              : `${flow.path.join(' › ')} · child flow`}
          </h4>
          <FlowSvg
            layout={flow.layout}
            path={flow.path}
            liveState={liveState}
            selected={selected}
            onSelect={onSelect}
          />
        </section>
      ))}
      {graph.warnings.length > 0 && (
        <ul className="self-start font-mono text-[11px] text-neutral-500">
          {graph.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.step ?? ''}`}>
              ⚠ {warning.code}
              {warning.step ? ` · ${warning.step}` : ''}: {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
