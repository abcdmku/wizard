import type { Manifest } from '@openwizard/core/inspect'
import { useId, useMemo } from 'react'
import {
  captionOf,
  EDGE_TONES,
  edgeTone,
  LOOK_CLASSES,
  type Look,
  lookOf,
  type NodeLiveState,
} from './graph-look'
import { arrowPath, type GraphLayout, layoutGraph, type PlacedNode, wizardsOf } from './layout'

export type NodeStateLookup = (path: readonly string[], id: string) => NodeLiveState | undefined

interface WizardGraphViewProps {
  readonly graph: Manifest
  readonly liveState?: NodeStateLookup | undefined
  readonly selected?: { readonly path: readonly string[]; readonly id: string } | null | undefined
  readonly onSelect?: ((path: readonly string[], id: string) => void) | undefined
}

/** A person's form is a pill, work is a box, and a child wizard is a box inside a box. */
function NodeShape({ node, className }: { readonly node: PlacedNode; readonly className: string }) {
  const { x, y, width, height } = node
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={node.node.kind === 'view' ? height / 2 : 8}
        className={className}
      />
      {node.node.kind === 'child' && (
        <rect
          x={x + 3.5}
          y={y + 3.5}
          width={width - 7}
          height={height - 7}
          rx={5}
          className={`${className} fill-none`}
          strokeWidth={1}
        />
      )}
    </>
  )
}

function WizardSvg({
  layout,
  path,
  name,
  liveState,
  selected,
  onSelect,
}: {
  readonly layout: GraphLayout
  readonly path: readonly string[]
  readonly name: string
} & Pick<WizardGraphViewProps, 'liveState' | 'selected' | 'onSelect'>) {
  const marker = useId()
  const states = new Map(layout.nodes.map(({ node }) => [node.id, liveState?.(path, node.id)]))
  const look = (id: string): Look => lookOf(states.get(id))
  const isSelected = (id: string) =>
    selected?.id === id && selected.path.join('/') === path.join('/')
  return (
    // biome-ignore lint/a11y/useSemanticElements: the SVG groups step buttons; `img` would hide them
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="block h-auto shrink-0 overflow-visible font-mono"
      // Shrinks to fit a narrow pane, but never so far that the step names stop being readable.
      style={{
        width: `clamp(${Math.round(layout.width * MIN_SCALE)}px, 100%, ${Math.round(layout.width)}px)`,
      }}
      role="group"
      aria-label={`Steps of the ${name} wizard and how they connect`}
    >
      <defs>
        {(['plain', 'lit', 'off'] as const).map((tone) => (
          <marker
            key={tone}
            id={`${marker}-${tone}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className={EDGE_TONES[tone].head} />
          </marker>
        ))}
      </defs>
      {layout.arrows.map((arrow) => {
        const tones = arrow.edges.map((edge) =>
          edgeTone(look(arrow.from), look(arrow.to), edge.kind),
        )
        const tone = tones.includes('lit') ? 'lit' : (tones[0] ?? 'plain')
        const dashed = arrow.edges.every((edge) => edge.kind !== 'next' && edge.kind !== 'needs')
        return (
          <g key={`${arrow.from}-${arrow.to}`}>
            <path
              d={arrowPath(arrow.points)}
              fill="none"
              strokeWidth={1.25}
              markerEnd={`url(#${marker}-${tone})`}
              className={`${EDGE_TONES[tone].line} ${dashed ? '[stroke-dasharray:5_4]' : ''}`}
            />
            {arrow.label && (
              <text
                x={arrow.labelX}
                y={arrow.labelY + 3}
                textAnchor="middle"
                strokeWidth={4}
                className={`stroke-paper text-[10px] [paint-order:stroke] dark:stroke-ink ${EDGE_TONES[tone].label}`}
              >
                {arrow.label}
              </text>
            )}
          </g>
        )
      })}
      {layout.nodes.map((laid) => {
        const state = states.get(laid.node.id)
        const classes = LOOK_CLASSES[lookOf(state)]
        const caption = captionOf(state)
        const centre = laid.x + laid.width / 2
        const chosen = isSelected(laid.node.id)
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG node group is the clickable target here
          <g
            key={laid.node.id}
            role="button"
            tabIndex={0}
            aria-pressed={chosen}
            aria-label={`${laid.node.id} (${laid.node.kind}${caption ? `, ${caption}` : ''})`}
            className="group cursor-pointer outline-none"
            onClick={() => onSelect?.(path, laid.node.id)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect?.(path, laid.node.id)
            }}
          >
            <rect
              x={laid.x - 4}
              y={laid.y - 4}
              width={laid.width + 8}
              height={laid.height + 8}
              rx={laid.node.kind === 'view' ? laid.height / 2 + 4 : 12}
              strokeWidth={1.5}
              className={`fill-transparent stroke-neutral-900 transition-opacity group-focus-visible:opacity-100 group-focus-visible:[stroke-dasharray:4_3] dark:stroke-neutral-100 ${
                chosen ? 'opacity-100' : 'opacity-0 group-hover:opacity-25'
              }`}
            />
            <NodeShape node={laid} className={`transition-colors ${classes.shape}`} />
            <text
              x={centre}
              y={laid.y + (caption ? 19 : 27)}
              textAnchor="middle"
              className={`text-[12px] font-semibold ${classes.id}`}
            >
              {laid.node.id}
            </text>
            {caption && (
              <text
                x={centre}
                y={laid.y + 34}
                textAnchor="middle"
                className={`text-[9.5px] ${classes.caption}`}
              >
                {caption}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** The smallest a graph is drawn, as a share of its natural size. Below it the pane scrolls. */
const MIN_SCALE = 0.8

const LEGEND = [
  { kind: 'view', shape: 'rounded-full', label: 'form' },
  { kind: 'step', shape: 'rounded-[3px]', label: 'step' },
  {
    kind: 'child',
    shape: 'rounded-[3px] outline outline-1 outline-offset-1 outline-current',
    label: 'child wizard',
  },
] as const

/** Every wizard of the graph: the root first, then each child wizard in its own box. */
export function WizardGraphView({ graph, liveState, selected, onSelect }: WizardGraphViewProps) {
  const wizards = useMemo(
    () =>
      wizardsOf(graph).map((wizard) => ({
        path: wizard.path,
        layout: layoutGraph(wizard.nodes, wizard.edges),
      })),
    [graph],
  )
  // The shapes need a key only when the wizard mixes them.
  const kinds = new Set(graph.nodes.map((node) => node.kind))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-neutral-500">
        <h4 className="text-neutral-700 dark:text-neutral-300">
          {graph.name} <span className="text-neutral-500">v{graph.version}</span>
        </h4>
        <ul className="flex items-center gap-3" aria-label="Legend">
          {LEGEND.filter((item) => kinds.size > 1 && kinds.has(item.kind)).map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-3.5 border border-current ${item.shape}`} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="-mx-4 flex flex-col gap-4 [align-items:safe_center] overflow-x-auto px-4 py-1 [&>*]:max-w-none">
        {wizards.map(({ path, layout }) =>
          path.length === 0 ? (
            <WizardSvg
              key="root"
              layout={layout}
              path={path}
              name={graph.name}
              liveState={liveState}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <section
              key={path.join('/')}
              className="flex flex-col items-center rounded-[10px] border border-dashed border-neutral-300 px-3 pt-2 pb-1 dark:border-neutral-700"
            >
              <h5 className="self-start font-mono text-[10.5px] font-normal text-neutral-500">
                inside {path.join(' / ')}
              </h5>
              <WizardSvg
                layout={layout}
                path={path}
                name={path.join(' / ')}
                liveState={liveState}
                selected={selected}
                onSelect={onSelect}
              />
            </section>
          ),
        )}
      </div>
      {graph.warnings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {graph.warnings.map((warning) => (
            <li
              key={`${warning.code}-${warning.step ?? ''}`}
              className="rounded-md border border-neutral-200 bg-paper-2 px-3 py-2 text-[12.5px] leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-ink-2 dark:text-neutral-400"
            >
              <span className="mr-2 font-mono text-[11px] font-medium text-neutral-900 dark:text-neutral-100">
                {warning.code}
                {warning.step ? ` · ${warning.step}` : ''}
              </span>
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
