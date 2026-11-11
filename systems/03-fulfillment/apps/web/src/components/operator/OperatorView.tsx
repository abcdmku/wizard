import { AlertTriangle, ListFilter, Search, ShieldAlert, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { OperatorOrder } from '../../contracts'
import { fraudNeedsAction, orderNumber } from '../../contracts'
import type { FulfillmentState } from '../../use-fulfillment'
import { OperatorOrderDetail } from './OperatorOrderDetail'
import { OperatorOrderList } from './OperatorOrderList'

type QueueFilter = 'all' | 'review' | 'exceptions'

export function OperatorView({ state }: { state: FulfillmentState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [query, setQuery] = useState('')
  const reviewCount = state.operatorOrders.filter(fraudNeedsAction).length
  const exceptionCount = state.operatorOrders.filter(
    (order) =>
      order.status === 'failed' || order.status === 'cancelling' || order.workflow.deadLetter,
  ).length
  const orders = useMemo(
    () => state.operatorOrders.filter((order) => matches(order, filter, query)),
    [filter, query, state.operatorOrders],
  )
  const selected = orders.find((order) => order.id === selectedId) ?? orders[0]

  useEffect(() => {
    if (selected !== undefined && selectedId === null) setSelectedId(selected.id)
  }, [selected, selectedId])

  const setQueue = (next: QueueFilter) => {
    setFilter(next)
    const first = state.operatorOrders.find((order) => matches(order, next, query))
    setSelectedId(first?.id ?? null)
  }

  return (
    <div className="operator-page page-frame">
      <section className="ops-hero">
        <div>
          <p className="eyebrow">Operations console</p>
          <h1>Fulfillment control room</h1>
          <p>Inspect waits, clear reviews, and trace failed compensation.</p>
        </div>
        <span className="operator-identity">
          <span className="avatar">OO</span>
          <span>
            <small>On duty</small>
            <strong>operator-olivia</strong>
          </span>
        </span>
      </section>
      <section className="metric-grid" aria-label="Queue summary">
        <article>
          <span className="metric-icon metric-active">
            <Workflow size={18} />
          </span>
          <span>
            <small>Active workflows</small>
            <strong>
              {
                state.operatorOrders.filter(
                  (order) => !['failed', 'cancelled', 'shipped'].includes(order.status),
                ).length
              }
            </strong>
          </span>
        </article>
        <article>
          <span className="metric-icon metric-review">
            <ShieldAlert size={18} />
          </span>
          <span>
            <small>Fraud review</small>
            <strong>{reviewCount}</strong>
          </span>
        </article>
        <article>
          <span className="metric-icon metric-failure">
            <AlertTriangle size={18} />
          </span>
          <span>
            <small>Exceptions</small>
            <strong>{exceptionCount}</strong>
          </span>
        </article>
      </section>
      <div className="ops-workspace">
        <aside className="ops-queue" aria-labelledby="ops-queue-title">
          <div className="ops-queue-heading">
            <div>
              <p className="eyebrow">Work queue</p>
              <h2 id="ops-queue-title">Orders</h2>
            </div>
            <ListFilter size={17} />
          </div>
          <div className="queue-tabs" role="tablist" aria-label="Filter orders">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              onClick={() => setQueue('all')}
            >
              All <span>{state.operatorOrders.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'review'}
              onClick={() => setQueue('review')}
            >
              Review <span>{reviewCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'exceptions'}
              onClick={() => setQueue('exceptions')}
            >
              Failures <span>{exceptionCount}</span>
            </button>
          </div>
          <label className="queue-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search orders</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search order or customer"
            />
          </label>
          <OperatorOrderList
            orders={orders}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
        </aside>
        {selected ? (
          <OperatorOrderDetail
            key={selected.id}
            order={selected}
            isPending={state.isPending}
            actionError={state.actionError}
            onDecide={async (request) => {
              await state.decideFraud(selected.id, request)
            }}
          />
        ) : (
          <div className="ops-no-selection">
            <ShieldAlert size={22} />
            <h2>Queue is clear</h2>
            <p>No orders match this filter.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function matches(order: OperatorOrder, filter: QueueFilter, query: string): boolean {
  const matchesFilter =
    filter === 'all' ||
    (filter === 'review' && fraudNeedsAction(order)) ||
    (filter === 'exceptions' &&
      (order.status === 'failed' || order.status === 'cancelling' || order.workflow.deadLetter))
  const needle = query.trim().toLowerCase()
  return (
    matchesFilter &&
    (needle.length === 0 ||
      order.id.toLowerCase().includes(needle) ||
      orderNumber(order).toLowerCase().includes(needle) ||
      order.shippingAddress.recipient.toLowerCase().includes(needle))
  )
}
