import { AlertOctagon, Boxes, CircleDot, Clock3, Copy, MapPin, RotateCcw } from 'lucide-react'
import type { FraudDecision, OperatorOrder } from '../../contracts'
import {
  compensationSteps,
  failureStep,
  normalizeBranchStatus,
  operatorBranches,
  operatorCurrentStepLabel,
  orderNumber,
} from '../../contracts'
import { money, shortDate } from '../../format'
import { StatusBadge } from '../shared/StatusBadge'
import { FraudPanel } from './FraudPanel'

export function OperatorOrderDetail({
  order,
  isPending,
  actionError,
  onDecide,
}: {
  order: OperatorOrder
  isPending: (key: string) => boolean
  actionError: (key: string) => string | undefined
  onDecide: (request: FraudDecision) => Promise<void>
}) {
  const branches = operatorBranches(order)
  const failure = failureStep(order)
  const compensations = compensationSteps(order)
  return (
    <article className="ops-detail" aria-labelledby="ops-order-title">
      <header className="ops-detail-header">
        <div>
          <p className="eyebrow">Workflow instance</p>
          <div className="order-id-line">
            <h2 id="ops-order-title">{orderNumber(order)}</h2>
            <button
              className="copy-button"
              type="button"
              title="Copy order ID"
              aria-label="Copy order ID"
              onClick={() => void navigator.clipboard.writeText(order.id)}
            >
              <Copy size={14} />
            </button>
          </div>
          <code className="order-uuid">{order.id}</code>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <dl className="workflow-meta">
        <div>
          <dt>Current step</dt>
          <dd>
            <CircleDot size={13} />
            {operatorCurrentStepLabel(order.status, order.workflow.current)}
          </dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>#{order.workflow.seq}</dd>
        </div>
        <div>
          <dt>Buffered</dt>
          <dd>{order.workflow.bufferedCallbacks} callbacks</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{shortDate(order.updatedAt)}</dd>
        </div>
      </dl>

      <section className="ops-section" aria-labelledby="parallel-checks-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Fan-out</p>
            <h3 id="parallel-checks-title">Payment + inventory</h3>
          </div>
          <span className="parallel-chip">Parallel branches</span>
        </div>
        <div className="ops-branch-grid">
          {branches.map((branch) => (
            <div className="ops-branch-card" key={branch.label}>
              <div>
                <span className="ops-branch-icon">
                  <Boxes size={16} />
                </span>
                <strong>{branch.label}</strong>
              </div>
              <StatusBadge status={branch.status} />
              <dl>
                <div>
                  <dt>Attempt</dt>
                  <dd>{branch.attempt}</dd>
                </div>
                <div>
                  <dt>Partner state</dt>
                  <dd>{branch.message}</dd>
                </div>
                {branch.reference && (
                  <div>
                    <dt>Reference</dt>
                    <dd>
                      <code>{branch.reference}</code>
                    </dd>
                  </div>
                )}
              </dl>
              {branch.error && <p className="inline-error">{branch.error}</p>}
            </div>
          ))}
        </div>
      </section>

      <FraudPanel
        order={order}
        isPending={isPending}
        actionError={actionError}
        onDecide={onDecide}
      />

      {order.status === 'shipping' && (
        <section className="shipping-wait" aria-labelledby="shipping-wait-title">
          <span className="wait-icon">
            <Clock3 size={18} />
          </span>
          <div>
            <p className="eyebrow">External callback</p>
            <h3 id="shipping-wait-title">Waiting for shipment confirmation</h3>
            <p>
              The workflow is parked until the carrier callback arrives. No worker is held open.
            </p>
            {order.partnerState.shipment.requestId && (
              <code>{order.partnerState.shipment.requestId}</code>
            )}
          </div>
          <StatusBadge status="waiting" />
        </section>
      )}

      {failure && (
        <section className="incident-panel" aria-labelledby="failure-title">
          <div className="incident-title">
            <AlertOctagon size={18} />
            <div>
              <p className="eyebrow">Exception</p>
              <h3 id="failure-title">{failure.error?.code ?? 'Workflow failed'}</h3>
            </div>
          </div>
          <p>{failure.error?.message}</p>
          <dl>
            <div>
              <dt>Step</dt>
              <dd>{failure.id}</dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>{failure.attempt}</dd>
            </div>
          </dl>
          {order.workflow.deadLetter && (
            <div className="dlq-state">
              <strong>Dead-letter queue</strong>
              <span>Message retained for operator inspection and replay.</span>
              <code>order-events-dlq · seq {order.workflow.seq}</code>
            </div>
          )}
        </section>
      )}

      {compensations.length > 0 && (
        <section className="ops-section" aria-labelledby="compensation-title">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Saga rollback</p>
              <h3 id="compensation-title">Compensation</h3>
            </div>
            <RotateCcw size={17} aria-hidden="true" />
          </div>
          <div className="compensation-list">
            {compensations.map((step) => (
              <div key={`${step.id}-${step.attempt}`}>
                <span>
                  <strong>{step.id.replaceAll('-', ' ')}</strong>
                  <small>Attempt {step.attempt}</small>
                </span>
                <StatusBadge status={normalizeBranchStatus(step.status, step)} />
                {step.error && <p className="inline-error">{step.error.message}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ops-section ops-order-facts" aria-labelledby="order-facts-title">
        <div className="section-heading-row">
          <h3 id="order-facts-title">Order facts</h3>
          <strong>{money(order.totalMinor, order.currency)}</strong>
        </div>
        <p>
          <MapPin size={14} /> {order.shippingAddress.recipient} · {order.shippingAddress.line1},{' '}
          {order.shippingAddress.city}, {order.shippingAddress.region}{' '}
          {order.shippingAddress.postalCode}
        </p>
        <ul>
          {order.lines.map((line) => (
            <li key={line.sku}>
              <span>
                {line.quantity} × {line.name}
              </span>
              <code>{line.sku}</code>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
