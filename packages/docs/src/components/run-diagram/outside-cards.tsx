import { ArrowDownLeft, ArrowUpRight, SquarePen } from 'lucide-react'
import { type CSSProperties, useMemo } from 'react'
import type { OutsideCard } from './outside'

const cardKey = (card: OutsideCard): string =>
  card.kind === 'form' ? `form:${card.step}` : `${card.kind}:${card.id}`

function FormBody({ card }: { readonly card: Extract<OutsideCard, { kind: 'form' }> }) {
  const fields = Object.entries(card.fields)
  return (
    <>
      <p className="rd-card-title">
        <SquarePen aria-hidden="true" />
        Form for <b>{card.step}</b>
      </p>
      {fields.length === 0 ? (
        <p className="rd-card-line is-muted">Nothing typed yet</p>
      ) : (
        <dl className="rd-fields">
          {fields.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="rd-card-state">
        {card.state === 'submitted'
          ? 'Submitted'
          : card.state === 'invalid'
            ? `Refused: ${card.issue}`
            : 'Waiting for the person'}
      </p>
    </>
  )
}

function CallBody({ card }: { readonly card: Extract<OutsideCard, { kind: 'call' }> }) {
  return (
    <>
      <p className="rd-card-title">
        <ArrowUpRight aria-hidden="true" />
        Service call
      </p>
      <p className="rd-card-line">
        deps.{card.name}({card.args})
      </p>
      <p className="rd-card-state">
        {card.state === 'pending'
          ? 'Waiting for a reply'
          : card.state === 'returned'
            ? `Returned ${card.result}`
            : `Threw: ${card.result}`}
      </p>
    </>
  )
}

function EventBody({ card }: { readonly card: Extract<OutsideCard, { kind: 'event' }> }) {
  return (
    <>
      <p className="rd-card-title">
        <ArrowDownLeft aria-hidden="true" />
        Event sent to the run
      </p>
      <p className="rd-card-line">
        {card.name} {card.payload}
      </p>
      <p className="rd-card-state">
        {card.state === 'delivered'
          ? `Delivered ${card.detail}`
          : card.state === 'rejected'
            ? `Refused: ${card.detail}`
            : 'Kept until a step waits for it'}
      </p>
    </>
  )
}

const TONE: Readonly<Record<string, string>> = {
  open: 'waiting',
  pending: 'running',
  received: 'waiting',
  submitted: 'done',
  returned: 'done',
  delivered: 'done',
  invalid: 'failed',
  threw: 'failed',
  rejected: 'failed',
}

const body = (card: OutsideCard) =>
  card.kind === 'form' ? (
    <FormBody card={card} />
  ) : card.kind === 'call' ? (
    <CallBody card={card} />
  ) : (
    <EventBody card={card} />
  )

/** Every card of a recording in the order they appear, each with all the versions it goes through. */
function slotsOf(frames: readonly { readonly outside: readonly OutsideCard[] }[]) {
  const slots = new Map<string, Map<string, OutsideCard>>()
  for (const frame of frames) {
    for (const card of frame.outside) {
      const versions = slots.get(cardKey(card)) ?? new Map<string, OutsideCard>()
      versions.set(JSON.stringify(card), card)
      slots.set(cardKey(card), versions)
    }
  }
  return [...slots].map(([key, versions]) => ({ key, versions: [...versions.values()] }))
}

/**
 * What is outside the run at one frame: forms, service calls and events. `frames` is the whole
 * recording. Each card has a slot from the start, sized for its tallest version, so the diagram
 * does not change height while it plays. A slot stays an empty outline until its card appears.
 */
export function OutsideCards({
  now,
  frames,
}: {
  readonly now: readonly OutsideCard[]
  readonly frames: readonly { readonly outside: readonly OutsideCard[] }[]
}) {
  const slots = useMemo(() => slotsOf(frames), [frames])
  if (slots.length === 0) return null
  const current = new Map(now.map((card) => [cardKey(card), card]))
  // Four cards sit in one row or two by two. Three columns would leave one alone on a second row.
  const four = slots.length === 4
  return (
    <div className="rd-outside">
      <p className="rd-outside-title">Outside the run</p>
      <ul
        style={{ '--rd-columns': four ? 2 : 3, '--rd-columns-wide': four ? 4 : 3 } as CSSProperties}
      >
        {slots.map(({ key, versions }) => {
          const card = current.get(key)
          const shown = card ? JSON.stringify(card) : undefined
          return (
            <li key={key} className={`rd-slot${card ? '' : ' is-empty'}`}>
              {versions.map((version) => {
                const id = JSON.stringify(version)
                return (
                  <div
                    key={id}
                    className={`rd-card is-${TONE[version.state] ?? 'waiting'}${id === shown ? ' is-current' : ''}`}
                    aria-hidden={id === shown ? undefined : true}
                  >
                    {body(version)}
                  </div>
                )
              })}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
