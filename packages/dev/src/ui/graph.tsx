import type { Manifest } from '@openwizard/core/inspect'
import { Fragment, type ReactElement, useId, useMemo } from 'react'
import { arrowPath, type GraphLayout, labelWidth, layoutGraph, wizardsOf } from './graph-layout'

/** One step at one moment. `phase` is the live phase from `run.explain`, such as `waiting`. */
export interface StepFrame {
  readonly status: string
  readonly phase?: string
}

/** Steps by key: the child path and the id, joined with `/`. */
export type Frames = Readonly<Record<string, StepFrame>>

type Look =
  | 'idle'
  | 'blocked'
  | 'running'
  | 'waiting'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'undoing'
  | 'undone'

function lookOf(step: StepFrame | undefined): Look {
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

const keyOf = (path: readonly string[], id: string): string => [...path, id].join('/')

function WizardSvg(props: {
  readonly layout: GraphLayout
  readonly path: readonly string[]
  readonly frames: Frames
  readonly name: string
  readonly selected: string | null
  readonly onSelect?: ((key: string) => void) | undefined
}): ReactElement {
  const { layout, path, frames, onSelect } = props
  const marker = useId()
  const look = (id: string) => lookOf(frames[keyOf(path, id)])
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="g-svg"
      style={{ width: `min(100%, ${Math.round(layout.width * 1.15)}px)` }}
      role="img"
      aria-label={`Steps of the ${props.name} wizard and how they connect`}
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
            <path d="M 0 0 L 10 5 L 0 10 z" className="g-arrow" data-tone={tone} />
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
              className="g-edge"
              data-tone={tone}
              data-dashed={dashed || undefined}
            />
            {arrow.label && (
              <>
                <rect
                  x={arrow.labelX - labelWidth(arrow.label) / 2}
                  y={arrow.labelY - 9}
                  width={labelWidth(arrow.label)}
                  height={18}
                  className="g-gap"
                />
                <text
                  x={arrow.labelX}
                  y={arrow.labelY + 4}
                  textAnchor="middle"
                  className="g-label"
                  data-tone={tone}
                >
                  {arrow.label}
                </text>
              </>
            )}
          </g>
        )
      })}
      {layout.nodes.map((laid) => {
        const key = keyOf(path, laid.node.id)
        const step = frames[key]
        const caption = captionOf(step)
        const centre = laid.x + laid.width / 2
        const pick = onSelect === undefined ? undefined : () => onSelect(key)
        return (
          <g
            key={laid.node.id}
            className="g-node"
            data-look={lookOf(step)}
            data-selected={props.selected === key || undefined}
            {...(pick === undefined
              ? {}
              : {
                  role: 'button',
                  tabIndex: 0,
                  onClick: pick,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      pick()
                    }
                  },
                })}
          >
            <title>{laid.node.description ?? laid.node.id}</title>
            <rect
              x={laid.x}
              y={laid.y}
              width={laid.width}
              height={laid.height}
              rx={laid.node.kind === 'view' ? 22 : 8}
            />
            <text x={centre} y={laid.y + (caption ? 19 : 27)} textAnchor="middle" className="g-id">
              {laid.node.id}
            </text>
            {caption && (
              <text x={centre} y={laid.y + 34} textAnchor="middle" className="g-status">
                {caption}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * The steps of a wizard, top to bottom, coloured by the frames of a run. A form is a pill, work
 * is a box and a child wizard is drawn in a box of its own. A click on a step selects it.
 */
export function Graph(props: {
  readonly manifest: Manifest
  readonly frames?: Frames
  readonly selected?: string | null
  readonly onSelect?: (key: string) => void
}): ReactElement {
  const { manifest } = props
  const wizards = useMemo(
    () =>
      wizardsOf(manifest).map((wizard) => ({
        path: wizard.path,
        layout: layoutGraph(wizard.nodes, wizard.edges),
      })),
    [manifest],
  )
  return (
    <div className="g-graphs">
      {wizards.map(({ path, layout }) => {
        const drawn = (
          <WizardSvg
            key="svg"
            layout={layout}
            path={path}
            frames={props.frames ?? {}}
            name={path.length === 0 ? manifest.name : path.join(' / ')}
            selected={props.selected ?? null}
            onSelect={props.onSelect}
          />
        )
        return path.length === 0 ? (
          <Fragment key="root">{drawn}</Fragment>
        ) : (
          <div key={path.join('/')} className="g-child">
            <span className="g-child-label">
              child wizard of <b>{path.join(' / ')}</b>
            </span>
            {drawn}
          </div>
        )
      })}
    </div>
  )
}

interface SnapshotNode {
  readonly state: { readonly steps: Readonly<Record<string, { readonly status?: string }>> }
  readonly children: Readonly<Record<string, SnapshotNode | undefined>>
}

/**
 * The frame of every step in a snapshot, child runs included. `phases` holds the live phase of
 * each step of the root run.
 */
export function framesOf(snapshot: unknown, phases: Readonly<Record<string, string>>): Frames {
  const out: Record<string, StepFrame> = {}
  const walk = (node: SnapshotNode | undefined, path: readonly string[]) => {
    if (node === undefined) return
    for (const [id, record] of Object.entries(node.state.steps)) {
      const phase = path.length === 0 ? phases[id] : undefined
      out[keyOf(path, id)] = {
        status: record.status ?? 'idle',
        ...(phase === undefined ? {} : { phase }),
      }
    }
    for (const [step, child] of Object.entries(node.children))
      if (step in node.state.steps) walk(child, [...path, step])
  }
  walk(snapshot as SnapshotNode, [])
  return out
}
