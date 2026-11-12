import { ArrowDownLeft, ArrowUpRight, SquarePen } from 'lucide-react'
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

/**
 * What is outside the run at one frame: forms, service calls and events. `all` is every card the
 * recording ever shows. A card that has not appeared yet keeps its place, so the diagram does not
 * change height while it plays.
 */
export function OutsideCards({
  now,
  all,
}: {
  readonly now: readonly OutsideCard[]
  readonly all: readonly OutsideCard[]
}) {
  if (all.length === 0) return null
  const current = new Map(now.map((card) => [cardKey(card), card]))
  return (
    <div className="rd-outside">
      <p className="rd-outside-title">Outside the run</p>
      <ul>
        {all.map((placeholder) => {
          const card = current.get(cardKey(placeholder))
          const shown = card ?? placeholder
          return (
            <li
              key={cardKey(placeholder)}
              className={`rd-card is-${TONE[shown.state] ?? 'waiting'}${card ? '' : ' is-future'}`}
              aria-hidden={card ? undefined : true}
            >
              {shown.kind === 'form' ? (
                <FormBody card={shown} />
              ) : shown.kind === 'call' ? (
                <CallBody card={shown} />
              ) : (
                <EventBody card={shown} />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
