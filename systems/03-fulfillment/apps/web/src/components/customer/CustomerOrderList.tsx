import { ChevronRight, Package } from 'lucide-react'
import type { CustomerOrder } from '../../contracts'
import { orderNumber } from '../../contracts'
import { money, shortDate } from '../../format'
import { StatusBadge } from '../shared/StatusBadge'

export function CustomerOrderList({
  orders,
  selectedId,
  onSelect,
}: {
  orders: CustomerOrder[]
  selectedId: string | null
  onSelect: (orderId: string) => void
}) {
  return (
    <section className="list-panel" aria-labelledby="recent-orders-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Order history</p>
          <h2 id="recent-orders-title">Recent orders</h2>
        </div>
        <span className="count-chip">{orders.length}</span>
      </div>
      <div className="order-list">
        {orders.map((order) => (
          <button
            key={order.id}
            className={`order-list-item ${selectedId === order.id ? 'selected' : ''}`}
            type="button"
            aria-pressed={selectedId === order.id}
            onClick={() => onSelect(order.id)}
          >
            <span className="order-item-icon">
              <Package size={17} aria-hidden="true" />
            </span>
            <span className="order-item-main">
              <span className="order-item-topline">
                <strong>{orderNumber(order)}</strong>
                <StatusBadge status={order.status} />
              </span>
              <span className="order-item-meta">
                {shortDate(order.createdAt)} · {order.lines.length}{' '}
                {order.lines.length === 1 ? 'item' : 'items'}
              </span>
              <span className="order-item-total">{money(order.totalMinor, order.currency)}</span>
            </span>
            <ChevronRight className="item-chevron" size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}
