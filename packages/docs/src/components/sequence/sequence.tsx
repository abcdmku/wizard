import { useId } from 'react'
import { type Message, type Note, sequences } from './sequences'

const WIDTH = 680
const HEAD = 34
const ROW = 46
const TOP = 12
const CHAR = 5.9

const isNote = (row: Message | Note): row is Note => 'at' in row

/** A sequence diagram: who sends what to whom, top to bottom. `name` picks it from `sequences.ts`. */
export function Sequence({ name }: { readonly name: string }) {
  const data = sequences[name]
  if (!data) throw new Error(`Sequence: no diagram named '${name}'`)
  const marker = useId()
  const lane = WIDTH / data.actors.length
  const x = (actor: number) => lane * actor + lane / 2
  const height = TOP + HEAD + data.rows.length * ROW + 14
  const rowY = (index: number) => TOP + HEAD + index * ROW + ROW / 2 + 8

  return (
    <figure className="seq-diagram not-prose">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={data.caption}>
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
            <line x1={x(i)} y1={TOP + HEAD} x2={x(i)} y2={height - 4} className="seq-life" />
            <rect x={x(i) - 74} y={TOP} width={148} height={HEAD} rx={8} className="seq-actor" />
            <text x={x(i)} y={TOP + HEAD / 2 + 4} textAnchor="middle" className="seq-actor-name">
              {actor}
            </text>
          </g>
        ))}
        {data.rows.map((row, i) => {
          const y = rowY(i)
          if (isNote(row)) {
            const width = Math.min(WIDTH - 16, row.text.length * CHAR + 22)
            const left = Math.max(8, Math.min(WIDTH - 8 - width, x(row.at) - width / 2))
            return (
              <g key={row.text + String(i)} className={`seq-note is-${row.tone ?? 'plain'}`}>
                <rect x={left} y={y - 13} width={width} height={26} rx={13} />
                <text x={left + width / 2} y={y + 4} textAnchor="middle">
                  {row.text}
                </text>
              </g>
            )
          }
          const from = x(row.from)
          const to = x(row.to)
          return (
            <g key={row.text + String(i)} className={`seq-message${row.reply ? ' is-reply' : ''}`}>
              <line
                x1={from}
                y1={y}
                x2={to + (to > from ? -2 : 2)}
                y2={y}
                markerEnd={`url(#${marker})`}
              />
              <text x={(from + to) / 2} y={y - 7} textAnchor="middle">
                {row.text}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption>{data.caption}</figcaption>
    </figure>
  )
}
