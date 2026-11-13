/**
 * Says what lies outside the view. A side with steps beyond it fades out and gets a button such
 * as `← 3 steps` that moves the view that way, and a step cut by the edge is covered, so no
 * name shows in half. Rendered inside `<ReactFlow>`.
 */

import { type InternalNode, Panel, useReactFlow, useStore } from '@xyflow/react'
import type { ReactElement, ReactNode } from 'react'
import { motion } from './Follow'

type Side = 'left' | 'right' | 'top' | 'bottom'

const SIDES = ['left', 'right', 'top', 'bottom'] as const
/** How much of the pane one press moves the view. */
const STEP = 0.6
/** Only the head of a child wizard counts: the rest of it is its own steps. */
const GROUP_HEAD = 40
/** The width of a step name in flow pixels: the card's padding and 14px monospace letters. */
const nameWidth = (id: string): number => 12 + id.length * 8.6
/** A step cut at the bottom keeps its name in view while this much of it shows (flow px). */
const NAME_HEIGHT = 24

const ARROW: Readonly<Record<Side, string>> = { left: '←', right: '→', top: '↑', bottom: '↓' }
const WORD: Readonly<Record<Side, string>> = {
  left: 'to the left',
  right: 'to the right',
  top: 'above',
  bottom: 'below',
}

/** The part of a cut step inside the pane, in pane pixels, and the side it is cut on. */
interface Cover {
  readonly side: Side
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Outside {
  readonly counts: Readonly<Record<Side, number>>
  readonly covers: readonly Cover[]
  /** A string that changes when anything above changes, for the store selector. */
  readonly key: string
}

function stepId(node: InternalNode): string {
  const step = (node.data as { readonly step?: { readonly id?: unknown } }).step
  return typeof step?.id === 'string' ? step.id : ''
}

function sideOf(x0: number, y0: number, x1: number, y1: number, w: number, h: number) {
  if (x0 < -0.5) return 'left'
  if (x1 > w + 0.5) return 'right'
  if (y0 < -0.5) return 'top'
  if (y1 > h + 0.5) return 'bottom'
  return undefined
}

/** How many steps are cut or hidden beyond each side, and the visible part of each cut one. */
function outside(
  lookup: ReadonlyMap<string, InternalNode>,
  transform: readonly [number, number, number],
  width: number,
  height: number,
): Outside {
  const [tx, ty, zoom] = transform
  const counts = { left: 0, right: 0, top: 0, bottom: 0 }
  const covers: Cover[] = []
  for (const node of lookup.values()) {
    if (node.type !== 'step' && node.type !== 'group') continue
    const p = node.internals.positionAbsolute
    const w = (node.measured.width ?? node.width ?? 0) * zoom
    const h =
      (node.type === 'group' ? GROUP_HEAD : (node.measured.height ?? node.height ?? 0)) * zoom
    const x0 = p.x * zoom + tx
    const y0 = p.y * zoom + ty
    const side = sideOf(x0, y0, x0 + w, y0 + h, width, height)
    if (side === undefined) continue
    counts[side] += 1
    const cx0 = Math.max(0, x0)
    const cy0 = Math.max(0, y0)
    const cx1 = Math.min(width, x0 + w)
    const cy1 = Math.min(height, y0 + h)
    // Names start at the top left of a card: a cut there always hides part of it.
    const nameCut =
      side === 'left' ||
      side === 'top' ||
      (side === 'right' && cx1 - cx0 < nameWidth(stepId(node)) * zoom) ||
      (side === 'bottom' && cy1 - cy0 < NAME_HEIGHT * zoom)
    if (cx1 > cx0 && cy1 > cy0 && nameCut)
      covers.push({ side, x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 })
  }
  const key = JSON.stringify([
    counts,
    covers.map((c) => [c.side, Math.round(c.x), Math.round(c.y), Math.round(c.width)]),
  ])
  return { counts, covers, key }
}

function Hint({ side, count }: { readonly side: Side; readonly count: number }): ReactElement {
  const flow = useReactFlow()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const move = () => {
    const { x, y, zoom } = flow.getViewport()
    const dx = side === 'left' ? width * STEP : side === 'right' ? -width * STEP : 0
    const dy = side === 'top' ? height * STEP : side === 'bottom' ? -height * STEP : 0
    void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: motion(200) })
  }
  const steps = count === 1 ? 'step' : 'steps'
  const arrow = <span aria-hidden="true">{ARROW[side]}</span>
  const after = side === 'right' || side === 'bottom'
  return (
    <button
      type="button"
      className="owd-more"
      data-side={side}
      onClick={move}
      aria-label={`Show ${count} more ${steps} ${WORD[side]}`}
    >
      {after ? null : arrow}
      {count} {steps}
      {after ? arrow : null}
    </button>
  )
}

/**
 * The fades, the covers over cut steps and the `N steps` buttons. `toolbar` is what else sits
 * in the top left corner (warnings, layout state), so the left and top buttons sit beside it.
 */
export function EdgeHints({ toolbar }: { readonly toolbar: ReactNode }): ReactElement {
  const { counts, covers } = useStore(
    (state) => outside(state.nodeLookup, state.transform, state.width, state.height),
    (a, b) => a.key === b.key,
  )
  return (
    <>
      {SIDES.map((side) =>
        counts[side] > 0 ? (
          <div key={side} className="owd-fade" data-side={side} aria-hidden="true" />
        ) : null,
      )}
      {covers.map((cover) => (
        <div
          key={`${cover.side}:${cover.x}:${cover.y}`}
          className="owd-cover"
          data-side={cover.side}
          aria-hidden="true"
          style={{ left: cover.x, top: cover.y, width: cover.width, height: cover.height }}
        />
      ))}
      <Panel position="top-left">
        <div className="owd-toolbar">
          {toolbar}
          {counts.left > 0 && <Hint side="left" count={counts.left} />}
          {counts.top > 0 && <Hint side="top" count={counts.top} />}
        </div>
      </Panel>
      {counts.right > 0 && (
        <div className="owd-more-right">
          <Hint side="right" count={counts.right} />
        </div>
      )}
      {counts.bottom > 0 && (
        <Panel position="bottom-left">
          <Hint side="bottom" count={counts.bottom} />
        </Panel>
      )}
    </>
  )
}
