import { ArrowUpRight, PackagePlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CustomerOrder } from '../../contracts'
import type { FulfillmentState } from '../../use-fulfillment'
import { EmptyState } from '../shared/StateViews'
import { CreateOrderForm } from './CreateOrderForm'
import { CustomerOrderDetail } from './CustomerOrderDetail'
import { CustomerOrderList } from './CustomerOrderList'

export function CustomerView({ state }: { state: FulfillmentState }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selected = useMemo(
    () => state.customerOrders.find((order) => order.id === selectedId) ?? state.customerOrders[0],
    [selectedId, state.customerOrders],
  )

  useEffect(() => {
    if (selected !== undefined && selectedId === null) setSelectedId(selected.id)
  }, [selected, selectedId])

  const create = async (request: Parameters<FulfillmentState['createOrder']>[0]) => {
    const order = await state.createOrder(request)
    if (order !== undefined) {
      setSelectedId(order.id)
      setCreating(false)
    }
  }

  const cancel = async (order: CustomerOrder) => {
    await state.cancelOrder(order.id)
  }

  return (
    <div className="customer-page page-frame">
      <section className="customer-hero">
        <div>
          <p className="eyebrow">Customer portal</p>
          <h1>Your orders, Alice</h1>
          <p>Follow each handoff from checkout to carrier pickup.</p>
        </div>
        <div className="customer-hero-actions">
          <span className="demo-account">
            <span className="avatar" aria-hidden="true">
              AA
            </span>
            <span>
              <small>Demo account</small>
              <strong>customer-alice · tenant-acme</strong>
            </span>
          </span>
          <button className="button button-primary" type="button" onClick={() => setCreating(true)}>
            <PackagePlus size={17} aria-hidden="true" /> New order
          </button>
        </div>
      </section>

      <aside className="demo-note">
        <Sparkles size={16} aria-hidden="true" />
        <span>
          <strong>Seeded scenarios are ready.</strong> Open a review, shipping wait, failure, or
          compensation run.
        </span>
        <button type="button" onClick={() => state.refresh()}>
          Refresh data <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </aside>

      {creating && (
        <CreateOrderForm
          pending={state.isPending('create-order')}
          error={state.actionError('create-order')}
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      )}

      {state.customerOrders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          message="Create your first order to watch the fulfillment workflow run."
          action={
            <button
              className="button button-primary"
              type="button"
              onClick={() => setCreating(true)}
            >
              Create an order
            </button>
          }
        />
      ) : (
        <div className="customer-workspace">
          <CustomerOrderList
            orders={state.customerOrders}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
          {selected && (
            <CustomerOrderDetail
              key={selected.id}
              order={selected}
              pending={state.isPending(`cancel:${selected.id}`)}
              error={state.actionError(`cancel:${selected.id}`)}
              onCancel={() => cancel(selected)}
            />
          )}
        </div>
      )}
    </div>
  )
}
