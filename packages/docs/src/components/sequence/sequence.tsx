import { useId } from 'react'
import { type Message, type Note, type SequenceData, sequences } from './sequences'

/** The measurements of one drawing. The narrow one is for phones, where 680 units would scroll. */
interface Size {
  readonly fit: 'wide' | 'narrow'
  readonly width: number
  readonly actor: number
  readonly head: number
  readonly row: number
  /** Width of one character of a message and of a note, at the sizes the stylesheet sets. */
  readonly messageChar: number
  readonly noteChar: number
}

const WIDE: Size = {
  fit: 'wide',
  width: 680,
  actor: 148,
  head: 34,
  row: 46,
  messageChar: 6.7,
  noteChar: 5.9,
}
const NARROW: Size = {
  fit: 'narrow',
  width: 350,
  actor: 108,
  head: 32,
  row: 50,
  messageChar: 6.7,
  noteChar: 5.7,
}
const TOP = 12
const EDGE = 4

const isNote = (row: Message | Note): row is Note => 'at' in row

/** The centre for a label of `width` that wants to sit at `x` and must stay inside the drawing. */
const within = (x: number, width: number, size: Size): number =>
  Math.max(EDGE + width / 2, Math.min(size.width - EDGE - width / 2, x))

function Drawing({ data, size }: { readonly data: SequenceData; readonly size: Size }) {
  const marker = useId()
  const lane = size.width / data.actors.length
  const x = (actor: number) => lane * actor + lane / 2
  const height = TOP + size.head + data.rows.length * size.row + 14
  const rowY = (index: number) => TOP + size.head + index * size.row + size.row / 2 + 8

  return (
    <svg
      viewBox={`0 0 ${size.width} ${height}`}
      className={`is-${size.fit}`}
      role="img"
      aria-label={data.caption}
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="seq-arrow" />
        </marker>
      </defs>
      {data.actors.map((actor, i) => (
        <g key={actor}>
          <line x1={x(i)} y1={TOP + size.head} x2={x(i)} y2={height - 4} className="seq-life" />
          <rect
            x={x(i) - size.actor / 2}
            y={TOP}
            width={size.actor}
            height={size.head}
            rx={8}
            className="seq-actor"
          />
          <text x={x(i)} y={TOP + size.head / 2 + 4} textAnchor="middle" className="seq-actor-name">
            {actor}
          </text>
        </g>
      ))}
      {data.rows.map((row, i) => {
        const y = rowY(i)
        if (isNote(row)) {
          const width = Math.min(size.width - 2 * EDGE, row.text.length * size.noteChar + 24)
          const centre = within(x(row.at), width, size)
          return (
            <g key={row.text + String(i)} className={`seq-note is-${row.tone ?? 'plain'}`}>
              <rect x={centre - width / 2} y={y - 13} width={width} height={26} rx={13} />
              <text x={centre} y={y + 4} textAnchor="middle">
                {row.text}
              </text>
            </g>
          )
        }
        const from = x(row.from)
        const to = x(row.to)
        const textWidth = row.text.length * size.messageChar
        return (
          <g key={row.text + String(i)} className={`seq-message${row.reply ? ' is-reply' : ''}`}>
            <line
              x1={from}
              y1={y}
              x2={to + (to > from ? -2 : 2)}
              y2={y}
              markerEnd={`url(#${marker})`}
            />
            <text x={within((from + to) / 2, textWidth, size)} y={y - 8} textAnchor="middle">
              {row.text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * A sequence diagram: who sends what to whom, top to bottom. `name` picks it from `sequences.ts`.
 * It is drawn twice, wide and narrow, and the stylesheet shows the one that fits the screen.
 */
export function Sequence({ name }: { readonly name: string }) {
  const data = sequences[name]
  if (!data) throw new Error(`Sequence: no diagram named '${name}'`)
  return (
    <figure className="seq-diagram not-prose">
      <Drawing data={data} size={WIDE} />
      <Drawing data={data} size={NARROW} />
      <figcaption>{data.caption}</figcaption>
    </figure>
  )
}
