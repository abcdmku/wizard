import type { ReactNode } from 'react'
import { classNames } from './classNames'
import { StatusBadge } from './Feedback'

export interface ReviewerQueueItem {
  id: string
  applicantName: string
  organization?: string
  program?: string
  amount?: string
  submittedAt?: string
  status: string
  risk?: string
  flags?: number
}

export interface ReviewerQueueProps {
  items: readonly ReviewerQueueItem[]
  onSelect?: (item: ReviewerQueueItem) => void
  selectedId?: string
  emptyMessage?: ReactNode
  ariaLabel?: string
  className?: string
}

function ApplicantName({
  item,
  onSelect,
}: {
  item: ReviewerQueueItem
  onSelect: ((item: ReviewerQueueItem) => void) | undefined
}) {
  if (!onSelect) return <span className="queue__applicant-name">{item.applicantName}</span>
  return (
    <button
      className="queue__applicant-button"
      type="button"
      onClick={() => onSelect(item)}
      aria-label={`Open ${item.applicantName}'s application`}
    >
      {item.applicantName}
    </button>
  )
}

function QueueBadges({ item }: { item: ReviewerQueueItem }) {
  return (
    <div className="queue__badges">
      <StatusBadge status={item.status} />
      {item.risk ? <StatusBadge status={item.risk} /> : null}
      {item.flags && item.flags > 0 ? (
        <span className="queue__flags">
          {item.flags} {item.flags === 1 ? 'flag' : 'flags'}
        </span>
      ) : null}
    </div>
  )
}

export function ReviewerQueue({
  items,
  onSelect,
  selectedId,
  emptyMessage = 'No applications match this queue.',
  ariaLabel = 'Applications awaiting review',
  className,
}: ReviewerQueueProps) {
  if (items.length === 0) {
    return (
      <div className={classNames('queue-empty', className)} role="status">
        <span className="queue-empty__mark" aria-hidden="true">
          \u2713
        </span>
        <p>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={classNames('queue', className)}>
      <div className="queue__table-wrap">
        <table className="queue__table">
          <caption className="sr-only">{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Applicant</th>
              <th scope="col">Program</th>
              <th scope="col">Request</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className={classNames(item.id === selectedId && 'is-selected')} key={item.id}>
                <th scope="row">
                  <ApplicantName item={item} onSelect={onSelect} />
                  {item.organization ? (
                    <span className="queue__organization">{item.organization}</span>
                  ) : null}
                </th>
                <td>{item.program ?? 'Not specified'}</td>
                <td>{item.amount ?? 'Not specified'}</td>
                <td>{item.submittedAt ?? 'Not submitted'}</td>
                <td>
                  <QueueBadges item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="queue__cards" aria-label={ariaLabel}>
        {items.map((item) => (
          <li
            className={classNames('queue-card', item.id === selectedId && 'is-selected')}
            key={item.id}
          >
            <div className="queue-card__heading">
              <div>
                <ApplicantName item={item} onSelect={onSelect} />
                {item.organization ? (
                  <span className="queue__organization">{item.organization}</span>
                ) : null}
              </div>
              <QueueBadges item={item} />
            </div>
            <dl className="queue-card__details">
              <div>
                <dt>Program</dt>
                <dd>{item.program ?? 'Not specified'}</dd>
              </div>
              <div>
                <dt>Request</dt>
                <dd>{item.amount ?? 'Not specified'}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{item.submittedAt ?? 'Not submitted'}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
