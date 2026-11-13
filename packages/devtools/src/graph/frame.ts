/**
 * Where to put the view of a graph too large to show whole at a readable zoom. The layers of the
 * graph become columns along the direction the layers run; the view takes the columns around
 * the focus that fit and stops between two columns, so no step is cut in half at an edge.
 *
 * @packageDocumentation
 */

import type { LayoutDirection } from '../layout/elk'

/** A root-level box in flow coordinates. */
export interface Box {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Room left free at each side of the pane, in screen pixels. */
export interface Padding {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** React Flow's viewport: the flow is drawn at `zoom` and moved by `x`, `y` screen pixels. */
export interface Viewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** What `frameView` needs. */
export interface FrameRequest {
  readonly boxes: readonly Box[]
  /** Ids of the boxes that must be in view. */
  readonly focus: readonly string[]
  readonly pane: { readonly width: number; readonly height: number }
  readonly padding: Padding
  readonly direction: LayoutDirection
  /** The smallest zoom at which a step id is readable. */
  readonly floor: number
  /** The largest zoom the view may use. */
  readonly maxZoom: number
}

/** The smallest side margin, in screen pixels. */
const SNUG = 6

interface Column {
  start: number
  end: number
  low: number
  high: number
  readonly ids: Set<string>
}

/** Boxes on the main axis `a` (along the layers) and the cross axis `b`. */
interface Span {
  readonly id: string
  readonly a: number
  readonly a2: number
  readonly b: number
  readonly b2: number
}

function columnsOf(spans: readonly Span[]): Column[] {
  const sorted = [...spans].sort((p, q) => p.a - q.a)
  const columns: Column[] = []
  for (const s of sorted) {
    const last = columns[columns.length - 1]
    if (last !== undefined && s.a < last.end) {
      last.end = Math.max(last.end, s.a2)
      last.low = Math.min(last.low, s.b)
      last.high = Math.max(last.high, s.b2)
      last.ids.add(s.id)
    } else columns.push({ start: s.a, end: s.a2, low: s.b, high: s.b2, ids: new Set([s.id]) })
  }
  return columns
}

/**
 * The viewport that shows the focus at a readable zoom with as many whole columns around it as
 * fit: first the column after the focus (where the run goes), then the one before, and so on.
 * The view stops between columns, zooming in a little when that is what it takes.
 */
export function frameView(request: FrameRequest): Viewport {
  const down = request.direction === 'down'
  const p = request.padding
  const [paneA, paneB] = down
    ? [request.pane.height, request.pane.width]
    : [request.pane.width, request.pane.height]
  const [padA0, padA1, padB0, padB1] = down
    ? [p.top, p.bottom, p.left, p.right]
    : [p.left, p.right, p.top, p.bottom]
  const roomA = paneA - padA0 - padA1
  const roomB = paneB - padB0 - padB1
  const spans: Span[] = request.boxes.map((box) =>
    down
      ? { id: box.id, a: box.y, a2: box.y + box.height, b: box.x, b2: box.x + box.width }
      : { id: box.id, a: box.x, a2: box.x + box.width, b: box.y, b2: box.y + box.height },
  )
  const columns = columnsOf(spans)
  const focus = new Set(request.focus)
  const [lo, hi] = choose(columns, focus, roomA / request.floor)
  const first = columns[lo]
  const last = columns[hi]
  if (first === undefined || last === undefined) return { x: 0, y: 0, zoom: request.floor }
  const inView = new Set<string>()
  for (let i = lo; i <= hi; i++) for (const id of columns[i]?.ids ?? []) inView.add(id)
  const across = spans.filter((span) => inView.has(span.id))
  const low = Math.min(...across.map((span) => span.b))
  const high = Math.max(...across.map((span) => span.b2))
  let zoom = Math.min(request.maxZoom, roomA / Math.max(1, last.end - first.start))
  zoom = Math.max(request.floor, Math.min(zoom, roomB / Math.max(1, high - low)))
  // Zoom in until the columns either side are out of the view altogether.
  const before = columns[lo - 1]?.end
  const after = columns[hi + 1]?.start
  if (before !== undefined && after !== undefined && after > before)
    zoom = Math.max(zoom, Math.min(request.maxZoom * 1.25, paneA / (after - before)))
  const viewA = place(columns, lo, hi, paneA / zoom, padA0 / zoom, padA1 / zoom)
  // Across the layers the side margins may shrink to a few pixels so one more whole card fits.
  // The top keeps its room, since the zoom controls sit there.
  const [edgeB0, edgeB1] = down ? [SNUG, SNUG] : [padB0, padB1]
  const viewB = placeAcross(across, focus, paneB / zoom, edgeB0 / zoom, edgeB1 / zoom)
  const [vx, vy] = down ? [viewB, viewA] : [viewA, viewB]
  return { x: -vx * zoom, y: -vy * zoom, zoom }
}

/**
 * The run of bands `[lo, hi]` to show in `room` flow units: the bands holding the focus, then
 * the next one after, the next one before, and so on while they fit.
 */
function choose(
  bands: readonly Column[],
  focus: ReadonlySet<string>,
  room: number,
): [number, number] {
  const hit = bands.flatMap((c, i) => ([...c.ids].some((id) => focus.has(id)) ? [i] : []))
  let lo = hit[0] ?? 0
  let hi = hit[hit.length - 1] ?? 0
  const fits = (i: number, j: number) => (bands[j]?.end ?? 0) - (bands[i]?.start ?? 0) <= room
  if (!fits(lo, hi)) hi = lo
  for (let grew = true; grew; ) {
    grew = false
    if (hi + 1 < bands.length && fits(lo, hi + 1)) {
      hi += 1
      grew = true
    }
    if (lo > 0 && fits(lo - 1, hi)) {
      lo -= 1
      grew = true
    }
  }
  return [lo, hi]
}

/**
 * Where the view starts (flow units) to show bands `[lo, hi]` inside its padding, with the bands
 * either side wholly out of view when the room allows, centred otherwise.
 */
function place(
  bands: readonly Column[],
  lo: number,
  hi: number,
  full: number,
  pad0: number,
  pad1: number,
): number {
  const first = bands[lo]
  const last = bands[hi]
  if (first === undefined || last === undefined) return 0
  const before = bands[lo - 1]?.end
  const after = bands[hi + 1]?.start
  const min = Math.max(before ?? Number.NEGATIVE_INFINITY, last.end + pad1 - full)
  const max = Math.min(
    after === undefined ? Number.POSITIVE_INFINITY : after - full,
    first.start - pad0,
  )
  const centre = (first.start + last.end) / 2 - (full + pad0 - pad1) / 2
  if (min > max) return Math.min(first.start - pad0, centre)
  return Math.min(max, Math.max(min, centre))
}

/**
 * Where the view starts across the layers: the start that cuts the fewest cards at its edges
 * while the focus stays in view, nearest the centre of the focus among equals.
 */
function placeAcross(
  spans: readonly Span[],
  focus: ReadonlySet<string>,
  full: number,
  pad0: number,
  pad1: number,
): number {
  const room = full - pad0 - pad1
  const low = Math.min(...spans.map((span) => span.b))
  const high = Math.max(...spans.map((span) => span.b2))
  if (high - low <= room) return (low + high) / 2 - (full + pad0 - pad1) / 2
  // A focus wider than the view keeps its first step in view.
  let own = spans.filter((span) => focus.has(span.id)).sort((p, q) => p.b - q.b)
  const wide = Math.max(...own.map((span) => span.b2)) - Math.min(...own.map((span) => span.b))
  if (wide > room) own = own.slice(0, 1)
  const fLow = Math.min(...own.map((span) => span.b))
  const fHigh = Math.max(...own.map((span) => span.b2))
  const centre = (fLow + fHigh) / 2 - (full + pad0 - pad1) / 2
  if (fHigh - fLow > room) return fLow - pad0
  const starts = [centre, ...spans.flatMap((span) => [span.b - pad0, span.b2 + pad1 - full])]
  let best = centre
  let bestCuts = Number.POSITIVE_INFINITY
  for (const start of starts) {
    if (start + pad0 > fLow + 0.5 || start + full - pad1 < fHigh - 0.5) continue
    const end = start + full
    const cuts = spans.filter(
      (span) => span.b2 > start && span.b < end && (span.b < start || span.b2 > end),
    ).length
    const better =
      cuts < bestCuts || (cuts === bestCuts && Math.abs(start - centre) < Math.abs(best - centre))
    if (better) {
      best = start
      bestCuts = cuts
    }
  }
  return best
}
