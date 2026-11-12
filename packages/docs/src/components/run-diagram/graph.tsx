import type { Manifest } from '@openwizard/core/inspect'
import { useId, useMemo } from 'react'
import { type DagLayout, type LaidOutEdge, layoutWizard, wizardsOf } from '../playground/dag-layout'
import { type Frame, type StepFrame, stepKey } from './record'

/** The look of a step: what colour it gets and which word sits under its name. */
export type Look =
  | 'idle'
  | 'blocked'
  | 'running'
  | 'waiting'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'undoing'
  | 'undone'

export function lookOf(step: StepFrame | undefined): Look {
  switch (step?.status) {
    case 'active':
      return step.phase === 'waiting' || step.phase === 'retrying' ? 'waiting' : 'running'
    case 'done':
      return 'done'
    case 'skipped':
    case 'cancelled':
      return 'skipped'
    case 'failed':
      return 'failed'
    case 'compensating':
      return 'undoing'
    case 'compensated':
      return 'undone'
    default:
      return step?.phase === 'blocked' ? 'blocked' : 'idle'
  }
}

/** The word under a step's name. A live phase says more than the status `active`. */
function captionOf(step: StepFrame | undefined): string | null {
  if (!step || (step.status === 'idle' && !step.phase)) return null
  if (step.status === 'active') return step.phase ?? 'active'
  if (step.status === 'idle') return 'waiting for needs'
  return step.status
}

const formatMs = (ms: number): string =>
  ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`

function edgeLabel({ edge, from }: LaidOutEdge): string | null {
  switch (edge.kind) {
    case 'needs':
      // A solid arrow already reads as "needs". Only the special kinds get a word.
      return edge.mode && edge.mode !== 'all'
        ? edge.mode === 'any'
          ? 'first to finish'
          : edge.mode
        : null
    case 'route':
      return 'may choose'
    case 'fallback':
      return 'fallback'
    case 'timeout':
      return from.node.timeout === undefined ? 'timeout' : `after ${formatMs(from.node.timeout)}`
    default:
      return null
  }
}

/** Room at each side of the drawing for edges that go around a row of steps. */
const SIDE = 44

/**
 * The curve of an edge. One that skips a row of steps bows out to the side of that row, so it
 * does not run behind the steps in between.
 */
function edgePath({ from, to, back }: LaidOutEdge, layout: DagLayout): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  if (back) {
    const right = Math.max(from.x + from.width, to.x + to.width) + 26
    const sy = from.y + from.height / 2
    return `M ${from.x + from.width} ${sy} C ${right} ${sy}, ${right} ${y2 - 30}, ${x2 + to.width / 4} ${y2 - 2}`
  }
  const between = layout.nodes.filter((node) => node.y > from.y && node.y < to.y)
  if (between.length === 0) {
    const bend = Math.max(18, (y2 - y1) / 2)
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2 - 2}`
  }
  const leftward = x1 <= x2
  const edgeOfRow = leftward
    ? Math.min(...between.map((node) => node.x)) - 18
    : Math.max(...between.map((node) => node.x + node.width)) + 18
  // A cubic reaches three quarters of the way to its control points, so overshoot.
  const reach = leftward ? Math.min(x1, edgeOfRow) : Math.max(x1, edgeOfRow)
  const pull = reach + (reach - (x1 + x2) / 2) * 0.34
  return `M ${x1} ${y1} C ${pull} ${y1 + (y2 - y1) * 0.3}, ${pull} ${y1 + (y2 - y1) * 0.7}, ${x2} ${y2 - 2}`
}

const STARTED: ReadonlySet<Look> = new Set(['running', 'waiting', 'done', 'undoing', 'undone'])

/** An edge lights up once its source has finished and its target has started. */
function edgeLook(from: Look, to: Look, kind: string): 'lit' | 'off' | 'plain' {
  const taken = kind === 'fallback' || kind === 'timeout' ? from === 'skipped' : from === 'done'
  if (taken && STARTED.has(to)) return 'lit'
  if (from === 'skipped' || to === 'skipped') return taken ? 'plain' : 'off'
  return 'plain'
}

function WizardSvg({
  layout,
  path,
  steps,
  name,
}: {
  readonly layout: DagLayout
  readonly path: readonly string[]
  readonly steps: Frame['steps']
  readonly name: string
}) {
  const marker = useId()
  const look = (id: string) => lookOf(steps[stepKey(path, id)])
  const skipsARow = layout.edges.some(
    (edge) => !edge.back && layout.nodes.some((node) => node.y > edge.from.y && node.y < edge.to.y),
  )
  const side = skipsARow ? SIDE : 0
  const arrows = layout.edges
    .filter(
      (edge, index, all) =>
        all.findIndex((other) => other.from === edge.from && other.to === edge.to) === index,
    )
    .map((laid) => ({
      laid,
      twins: layout.edges.filter((other) => other.from === laid.from && other.to === laid.to),
    }))
  return (
    <svg
      viewBox={`${-side} 0 ${layout.width + side * 2} ${layout.height}`}
      className="rd-svg"
      style={{ width: `min(100%, ${Math.round((layout.width + side * 2) * 1.25)}px)` }}
      role="img"
      aria-label={`Steps of the ${name} wizard and how they connect`}
    >
      <defs>
        {(['plain', 'lit', 'off'] as const).map((tone) => (
          <marker
            key={tone}
            id={`${marker}-${tone}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className={`rd-arrow is-${tone}`} />
          </marker>
        ))}
      </defs>
      {arrows.map(({ laid, twins }) => {
        // Two connections between the same steps share one arrow and one label.
        const tones = twins.map((twin) =>
          edgeLook(look(twin.edge.from ?? ''), look(twin.edge.to), twin.edge.kind),
        )
        const tone = tones.includes('lit') ? 'lit' : (tones[0] ?? 'plain')
        const label = [...new Set(twins.map(edgeLabel).filter(Boolean))].join(', ') || null
        // Put the label near the end that this edge does not share with its siblings.
        const fanOut = arrows.filter((other) => other.laid.from === laid.from).length
        const fanIn = arrows.filter((other) => other.laid.to === laid.to).length
        const along = fanOut > 1 ? 0.7 : fanIn > 1 ? 0.3 : 0.5
        const x1 = laid.from.x + laid.from.width / 2
        const x2 = laid.to.x + laid.to.width / 2
        const y1 = laid.from.y + laid.from.height
        const midX = x1 + (x2 - x1) * along
        const midY = y1 + (laid.to.y - y1) * along + (fanOut > 1 ? 0 : 5)
        const dashed = twins.every(({ edge }) => edge.kind !== 'next' && edge.kind !== 'needs')
        return (
          <g key={`${laid.edge.from}-${laid.edge.to}-${laid.edge.kind}`}>
            <path
              d={edgePath(laid, layout)}
              markerEnd={`url(#${marker}-${tone})`}
              className={`rd-edge is-${tone}${dashed ? ' is-dashed' : ''}`}
            />
            {label && (
              <text x={midX} y={midY} textAnchor="middle" className={`rd-edge-label is-${tone}`}>
                {label}
              </text>
            )}
          </g>
        )
      })}
      {layout.nodes.map((laid) => {
        const step = steps[stepKey(path, laid.node.id)]
        const caption = captionOf(step)
        const centre = laid.x + laid.width / 2
        return (
          <g key={laid.node.id} className={`rd-node is-${lookOf(step)}`}>
            <rect
              x={laid.x}
              y={laid.y}
              width={laid.width}
              height={laid.height}
              rx={laid.node.kind === 'view' ? 22 : 8}
            />
            <text x={centre} y={laid.y + (caption ? 18 : 26)} textAnchor="middle" className="rd-id">
              {laid.node.id}
            </text>
            {caption && (
              <text x={centre} y={laid.y + 33} textAnchor="middle" className="rd-status">
                {caption}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** The wizard's steps, coloured by one frame of a run. A child wizard is drawn in its own box. */
export function RunGraph({
  manifest,
  steps,
}: {
  readonly manifest: Manifest
  readonly steps: Frame['steps']
}) {
  const wizards = useMemo(
    () =>
      wizardsOf(manifest).map((wizard) => ({
        path: wizard.path,
        layout: layoutWizard(wizard.nodes, wizard.edges),
      })),
    [manifest],
  )
  return (
    <div className="rd-graphs">
      {wizards.map(({ path, layout }) =>
        path.length === 0 ? (
          <WizardSvg key="root" layout={layout} path={path} steps={steps} name={manifest.name} />
        ) : (
          <div key={path.join('/')} className="rd-child">
            <span className="rd-child-label">inside {path.join(' / ')}</span>
            <WizardSvg layout={layout} path={path} steps={steps} name={path.join(' / ')} />
          </div>
        ),
      )}
    </div>
  )
}
