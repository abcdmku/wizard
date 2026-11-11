import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react'
import type { OperatorOrder } from '../../contracts'
import { fraudNeedsAction, orderNumber } from '../../contracts'
import { money, shortDate } from '../../format'
import { StatusBadge } from '../shared/StatusBadge'

export function OperatorOrderList({
  orders,
  selectedId,
  onSelect,
}: {
  orders: OperatorOrder[]
  selectedId: string | null
  onSelect: (orderId: string) => void
}) {
  if (orders.length === 0) {
    return <p className="queue-empty">No orders match this view.</p>
  }
  return (
    <section className="ops-order-list" aria-label="Orders">
      {orders.map((order) => (
        <button
          key={order.id}
          className={`ops-order-row ${selectedId === order.id ? 'selected' : ''}`}
          type="button"
          onClick={() => onSelect(order.id)}
          aria-pressed={selectedId === order.id}
        >
          <span className="ops-row-top">
            <strong>{orderNumber(order)}</strong>
            <StatusBadge status={order.status} />
          </span>
          <span className="ops-row-customer">{order.shippingAddress.recipient}</span>
          <span className="ops-row-meta">
            {shortDate(order.updatedAt)} · {money(order.totalMinor, order.currency)}
          </span>
          {fraudNeedsAction(order) && (
            <span className="action-flag">
              <ShieldAlert size={13} aria-hidden="true" /> Decision needed
            </span>
          )}
          {order.workflow.deadLetter && (
            <span className="failure-flag">
              <AlertTriangle size={13} aria-hidden="true" /> In DLQ
            </span>
          )}
          <ChevronRight className="item-chevron" size={16} aria-hidden="true" />
        </button>
      ))}
    </section>
  )
}
