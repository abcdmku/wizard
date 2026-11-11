import { formatClock, hasColdChainBreach, titleCase } from '../lib/dispatch'
import type { Delivery, Escalation, InterventionAction, Vehicle } from '../model'
import { Icon } from './Icon'

interface DeliveryPanelProps {
  delivery: Delivery | undefined
  escalation: Escalation | undefined
  timezone: string
  vehicle: Vehicle | undefined
  onIntervene: (action: InterventionAction) => void
}

const actionCopy: Record<InterventionAction, string> = {
  contact_driver: 'Contact driver',
  reroute: 'Reroute',
  hold: 'Place on hold',
  cancel: 'Cancel delivery',
  complete: 'Mark complete',
}

function terminalMessage(status: Delivery['status']): string | undefined {
  if (status === 'completed') return 'Delivery completed. Operator controls are closed.'
  if (status === 'cancelled') return 'Delivery cancelled. Its procedure is now read-only.'
  return undefined
}

export function DeliveryPanel({
  delivery,
  escalation,
  timezone,
  vehicle,
  onIntervene,
}: DeliveryPanelProps) {
  if (!delivery) {
    return (
      <section className="panel detail-panel empty-state" aria-labelledby="detail-title">
        <span>
          <Icon name="box" />
        </span>
        <h2 id="detail-title">No active delivery</h2>
        <p>Select a vehicle or escalation to inspect its procedure.</p>
      </section>
    )
  }

  const breached = hasColdChainBreach(delivery)
  const terminal = terminalMessage(delivery.status)
  const actions = terminal ? [] : (escalation?.allowedActions ?? [])
  const { cargo } = delivery

  return (
    <section className="panel detail-panel" aria-labelledby="detail-title">
      <div className="panel-heading detail-heading">
        <div>
          <p className="eyebrow">Delivery {delivery.reference}</p>
          <h2 id="detail-title">{delivery.customer}</h2>
        </div>
        <span className={`status-badge delivery-${delivery.status}`}>
          {titleCase(delivery.status)}
        </span>
      </div>

      {breached ? (
        <div className="cold-alert" role="alert">
          <span>
            <Icon name="snow" />
          </span>
          <div>
            <strong>Cold-chain breach</strong>
            <p>
              Cargo is {cargo.tempC}°C. Safe range {cargo.minC}–{cargo.maxC}°C.
            </p>
          </div>
        </div>
      ) : cargo.coldChain ? (
        <div className="cold-ok" role="status">
          <Icon name="snow" />
          <span>Cold chain stable{cargo.tempC === undefined ? '' : ` at ${cargo.tempC}°C`}</span>
        </div>
      ) : null}

      <dl className="delivery-facts">
        <div>
          <dt>Vehicle</dt>
          <dd>{vehicle ? `${vehicle.label} · ${vehicle.driverName}` : 'Unassigned'}</dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd>{formatClock(delivery.eta, timezone)}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            {delivery.origin}
            <Icon name="arrow" />
            {delivery.destination}
          </dd>
        </div>
        <div>
          <dt>Cargo</dt>
          <dd>{cargo.label}</dd>
        </div>
      </dl>

      <div className="procedure-heading">
        <h3>Procedure</h3>
        <span>
          {delivery.procedure.filter((step) => step.status === 'complete').length}/
          {delivery.procedure.length}
        </span>
      </div>
      <ol className="procedure-list">
        {delivery.procedure.map((step) => (
          <li className={`procedure-${step.status}`} key={step.id}>
            <span className="procedure-marker">
              {step.status === 'complete' ? <Icon name="check" /> : null}
            </span>
            <div>
              <strong>{step.label}</strong>
              {step.detail ? <p>{step.detail}</p> : null}
              {step.timestamp ? <small>{formatClock(step.timestamp, timezone)}</small> : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="intervention-area">
        <h3>Operator controls</h3>
        {terminal ? <p className="terminal-note">{terminal}</p> : null}
        {!terminal && !actions.length ? (
          <p className="control-note">No intervention is available for this delivery.</p>
        ) : null}
        {actions.length ? (
          <div className="action-grid">
            {actions.map((action) => (
              <button
                className={action === 'cancel' ? 'action-button destructive' : 'action-button'}
                key={action}
                onClick={() => onIntervene(action)}
                type="button"
              >
                {actionCopy[action]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
