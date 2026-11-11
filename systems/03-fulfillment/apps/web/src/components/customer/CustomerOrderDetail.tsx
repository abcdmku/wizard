import { ExternalLink, MapPin, RotateCcw, Truck } from 'lucide-react'
import { useState } from 'react'
import type { CustomerOrder } from '../../contracts'
import { customerStatusMessage, isCustomerCancellable, orderNumber } from '../../contracts'
import { money, shortDate } from '../../format'
import { StatusBadge } from '../shared/StatusBadge'
import { CustomerProgress } from './CustomerProgress'

export function CustomerOrderDetail({
  order,
  pending,
  error,
  onCancel,
}: {
  order: CustomerOrder
  pending: boolean
  error: string | undefined
  onCancel: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const cancellable = isCustomerCancellable(order.status)
  return (
    <article className="detail-panel customer-detail" aria-labelledby="customer-order-title">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Placed {shortDate(order.createdAt)}</p>
          <h2 id="customer-order-title">{orderNumber(order)}</h2>
        </div>
        <StatusBadge status={order.status} />
      </header>
      <div className={`status-callout tone-${order.status}`}>
        <span className="callout-pulse" aria-hidden="true" />
        <div>
          <strong>{customerStatusMessage(order)}</strong>
          <span>Last updated {shortDate(order.updatedAt)}</span>
        </div>
      </div>
      <CustomerProgress order={order} />
      {order.shipment && (
        <section className="tracking-card" aria-label="Shipment tracking">
          <span className="tracking-icon">
            <Truck size={19} aria-hidden="true" />
          </span>
          <div>
            <small>{order.shipment.carrier}</small>
            <strong>{order.shipment.trackingNumber}</strong>
          </div>
          <a href={order.shipment.trackingUrl} target="_blank" rel="noreferrer">
            Track package <ExternalLink size={14} aria-hidden="true" />
          </a>
        </section>
      )}
      <section className="order-summary" aria-labelledby="order-summary-title">
        <div className="section-heading-row">
          <h3 id="order-summary-title">Order summary</h3>
          <strong>{money(order.totalMinor, order.currency)}</strong>
        </div>
        <ul className="line-items">
          {order.lines.map((line) => (
            <li key={line.sku}>
              <span className="line-thumb" aria-hidden="true">
                <MapPin size={15} />
              </span>
              <span>
                <strong>{line.name}</strong>
                <small>
                  {line.sku} · Qty {line.quantity}
                </small>
              </span>
              <span>{money(line.unitPriceMinor * line.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>
      </section>
      {cancellable && (
        <section className="cancel-zone" aria-label="Cancel order">
          {confirming ? (
            <div className="confirm-row">
              <p>Cancel this order? Completed steps may need a few minutes to reverse.</p>
              <div>
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  Keep order
                </button>
                <button
                  className="button button-danger"
                  type="button"
                  onClick={() => void onCancel()}
                  disabled={pending}
                >
                  {pending ? 'Cancelling…' : 'Yes, cancel'}
                </button>
              </div>
            </div>
          ) : (
            <button className="text-button" type="button" onClick={() => setConfirming(true)}>
              <RotateCcw size={15} aria-hidden="true" /> Cancel order
            </button>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </article>
  )
}
