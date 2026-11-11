import { Check, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { FraudDecision, OperatorOrder } from '../../contracts'
import { fraudNeedsAction, orderNumber } from '../../contracts'

export function FraudPanel({
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
  const [note, setNote] = useState(order.fraud.note ?? '')
  if (!fraudNeedsAction(order)) return null
  const approving = isPending(`fraud:${order.id}:approve`)
  const rejecting = isPending(`fraud:${order.id}:reject`)
  const error = actionError(`fraud:${order.id}:approve`) ?? actionError(`fraud:${order.id}:reject`)
  return (
    <section className="fraud-panel" aria-labelledby="fraud-review-title">
      <div className="fraud-panel-icon">
        <ShieldAlert size={19} aria-hidden="true" />
      </div>
      <div className="fraud-panel-body">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Human checkpoint</p>
            <h3 id="fraud-review-title">Fraud review</h3>
          </div>
          <span className="review-required">Decision required</span>
        </div>
        <p>{order.fraud.note ?? 'Automated checks routed this order to manual review.'}</p>
        <label className="field review-note">
          <span>
            Decision note <small>optional</small>
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder={`Add context for ${orderNumber(order)}`}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="fraud-actions">
          <button
            className="button button-danger-soft"
            type="button"
            disabled={approving || rejecting}
            onClick={() => void onDecide({ decision: 'reject', note })}
            aria-label={`Reject ${orderNumber(order)}`}
          >
            <X size={15} aria-hidden="true" /> {rejecting ? 'Rejecting…' : 'Reject & reverse'}
          </button>
          <button
            className="button button-success"
            type="button"
            disabled={approving || rejecting}
            onClick={() => void onDecide({ decision: 'approve', note })}
            aria-label={`Approve ${orderNumber(order)}`}
          >
            <Check size={15} aria-hidden="true" /> {approving ? 'Approving…' : 'Approve order'}
          </button>
        </div>
      </div>
    </section>
  )
}
