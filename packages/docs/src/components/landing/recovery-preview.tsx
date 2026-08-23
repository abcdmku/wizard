import { Check, Clock3, Database, RotateCcw, ServerCrash, ShieldCheck } from 'lucide-react'

const STEPS = [
  { name: 'validateOrder', detail: '42 ms', status: 'done' },
  { name: 'chargeCard', detail: 'idempotency: order_1042', status: 'done' },
  { name: 'fraudReview', detail: 'waiting for review.approved', status: 'waiting' },
  { name: 'fulfillOrder', detail: 'blocked by fraudReview', status: 'blocked' },
] as const

export function RecoveryPreview() {
  return (
    <div className="recovery-window" aria-label="Workflow recovery example">
      <div className="recovery-window-bar">
        <div className="recovery-window-title">
          <span className="recovery-product-mark">OW</span>
          <span>run / order-1042</span>
        </div>
        <span className="recovery-live-status">
          <span aria-hidden="true" /> waiting
        </span>
      </div>

      <div className="recovery-event">
        <div className="recovery-event-icon">
          <ServerCrash aria-hidden="true" />
        </div>
        <div>
          <strong>worker-a stopped</strong>
          <span>after chargeCard completed</span>
        </div>
        <time>10:42:16</time>
      </div>

      <div className="recovery-resume-line">
        <span />
        <div>
          <RotateCcw aria-hidden="true" />
          Restored snapshot 12 on worker-b
        </div>
        <span />
      </div>

      <div className="recovery-steps">
        {STEPS.map((step, index) => (
          <div className="recovery-step" key={step.name}>
            <div className={`recovery-step-state recovery-step-state-${step.status}`}>
              {step.status === 'done' ? <Check aria-hidden="true" /> : index + 1}
            </div>
            <div className="recovery-step-copy">
              <strong>{step.name}</strong>
              <span>{step.detail}</span>
            </div>
            <span className={`recovery-step-label recovery-step-label-${step.status}`}>
              {step.status}
            </span>
          </div>
        ))}
      </div>

      <div className="recovery-facts">
        <div>
          <Database aria-hidden="true" />
          <span>
            snapshot
            <strong>version 12</strong>
          </span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" />
          <span>
            lease owner
            <strong>worker-b</strong>
          </span>
        </div>
        <div>
          <Clock3 aria-hidden="true" />
          <span>
            timeout
            <strong>17m remaining</strong>
          </span>
        </div>
      </div>
    </div>
  )
}
