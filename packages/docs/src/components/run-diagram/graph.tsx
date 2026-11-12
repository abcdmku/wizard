import type { Manifest } from '@openwizard/core/inspect'
import { Fragment, useId, useMemo } from 'react'
import {
  arrowPath,
  COMPACT_BELOW,
  type GraphLayout,
  labelWidth,
  layoutGraph,
  wizardsOf,
} from './layout'
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
  fit,
}: {
  readonly layout: GraphLayout
  readonly path: readonly string[]
  readonly steps: Frame['steps']
  readonly name: string
  /** `wide` and `narrow` are two layouts of one graph. CSS shows the one that fits the screen. */
  readonly fit?: 'wide' | 'narrow'
}) {
  const marker = useId()
  const look = (id: string) => lookOf(steps[stepKey(path, id)])
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={`rd-svg${fit ? ` is-${fit}` : ''}`}
      style={{ width: `min(100%, ${Math.round(layout.width * 1.2)}px)` }}
      role="img"
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
            <path d="M 0 0 L 10 5 L 0 10 z" className={`rd-arrow is-${tone}`} />
          </marker>
        ))}
      </defs>
      {layout.arrows.map((arrow) => {
        const tones = arrow.edges.map((edge) =>
          edgeLook(look(arrow.from), look(arrow.to), edge.kind),
        )
        const tone = tones.includes('lit') ? 'lit' : (tones[0] ?? 'plain')
        const dashed = arrow.edges.every((edge) => edge.kind !== 'next' && edge.kind !== 'needs')
        return (
          <g key={`${arrow.from}-${arrow.to}`}>
            <path
              d={arrowPath(arrow.points)}
              markerEnd={`url(#${marker}-${tone})`}
              className={`rd-edge is-${tone}${dashed ? ' is-dashed' : ''}`}
            />
            {arrow.label && (
              <>
                <rect
                  x={arrow.labelX - labelWidth(arrow.label) / 2}
                  y={arrow.labelY - 9}
                  width={labelWidth(arrow.label)}
                  height={18}
                  className="rd-edge-gap"
                />
                <text
                  x={arrow.labelX}
                  y={arrow.labelY + 4}
                  textAnchor="middle"
                  className={`rd-edge-label is-${tone}`}
                >
                  {arrow.label}
                </text>
              </>
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
            <text x={centre} y={laid.y + (caption ? 19 : 27)} textAnchor="middle" className="rd-id">
              {laid.node.id}
            </text>
            {caption && (
              <text x={centre} y={laid.y + 34} textAnchor="middle" className="rd-status">
                {caption}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** The width of the widest wizard in a manifest, in the units its steps are drawn in. */
export function graphWidth(manifest: Manifest): number {
  return Math.round(
    Math.max(...wizardsOf(manifest).map((wizard) => layoutGraph(wizard.nodes, wizard.edges).width)),
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
      wizardsOf(manifest).map((wizard) => {
        const layout = layoutGraph(wizard.nodes, wizard.edges)
        const compact =
          layout.width > COMPACT_BELOW ? layoutGraph(wizard.nodes, wizard.edges, true) : undefined
        return { path: wizard.path, layout, compact }
      }),
    [manifest],
  )
  return (
    <div className="rd-graphs">
      {wizards.map(({ path, layout, compact }) => {
        const name = path.length === 0 ? manifest.name : path.join(' / ')
        const drawn = (
          <>
            <WizardSvg
              layout={layout}
              path={path}
              steps={steps}
              name={name}
              {...(compact ? { fit: 'wide' as const } : {})}
            />
            {compact && (
              <WizardSvg layout={compact} path={path} steps={steps} name={name} fit="narrow" />
            )}
          </>
        )
        return path.length === 0 ? (
          <Fragment key="root">{drawn}</Fragment>
        ) : (
          <div key={path.join('/')} className="rd-child">
            <span className="rd-child-label">
              child wizard of <b>{path.join(' / ')}</b>
            </span>
            {drawn}
          </div>
        )
      })}
    </div>
  )
}
