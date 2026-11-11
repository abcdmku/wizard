import { formatClock, sortEscalations } from '../lib/dispatch'
import type { Escalation } from '../model'
import { Icon } from './Icon'

interface EscalationQueueProps {
  escalations: ReadonlyArray<Escalation>
  selectedDeliveryId: string | undefined
  timezone: string
  onSelect: (deliveryId: string) => void
}

export function EscalationQueue({
  escalations,
  selectedDeliveryId,
  timezone,
  onSelect,
}: EscalationQueueProps) {
  const sorted = sortEscalations(escalations)

  return (
    <section className="panel queue-panel" aria-labelledby="queue-title">
      <div className="panel-heading queue-heading">
        <div>
          <p className="eyebrow">Decision required</p>
          <h2 id="queue-title">Escalation queue</h2>
        </div>
        <span className="count-badge">
          <span aria-hidden="true">{sorted.length.toString().padStart(2, '0')}</span>
          <span className="sr-only">{sorted.length} escalations</span>
        </span>
      </div>
      {sorted.length ? (
        <ol className="escalation-list">
          {sorted.map((item, index) => {
            const selected = item.deliveryId === selectedDeliveryId
            return (
              <li key={item.id}>
                <button
                  aria-pressed={selected}
                  className={`escalation-card severity-${item.severity}${selected ? ' selected' : ''}`}
                  onClick={() => onSelect(item.deliveryId)}
                  type="button"
                >
                  <span className="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className="escalation-body">
                    <span className="escalation-meta">
                      <span className={`priority-band band-${item.band.toLowerCase()}`}>
                        {item.band}
                      </span>
                      <span className="severity-label">
                        <i aria-hidden="true" />
                        {item.severity}
                      </span>
                      <span>{formatClock(item.createdAt, timezone)}</span>
                      <span>Score {item.score}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <Icon name="arrow" />
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="empty-state queue-empty">
          <span>
            <Icon name="check" />
          </span>
          <strong>Queue clear</strong>
          <p>No delivery needs an operator decision.</p>
        </div>
      )}
    </section>
  )
}
