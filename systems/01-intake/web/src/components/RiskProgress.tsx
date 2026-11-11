import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

export interface RiskProgressProps extends HTMLAttributes<HTMLDivElement> {
  status: string
  message?: string
  progress?: number
  label?: string
}

interface RiskMeta {
  label: string
  value: number
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  indeterminate?: boolean
}

function riskMeta(status: string): RiskMeta {
  const value = status
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  if (
    [
      'checking',
      'loading',
      'pending',
      'running',
      'processing',
      'risk-review',
      'eligibility-pending',
    ].includes(value)
  ) {
    return { label: 'Screening in progress', value: 42, tone: 'info', indeterminate: true }
  }
  if (['low', 'low-risk', 'passed'].includes(value)) {
    return { label: 'Low risk', value: 28, tone: 'success' }
  }
  if (
    ['medium', 'medium-risk', 'review', 'awaiting-reviewer', 'changes-requested'].includes(value)
  ) {
    return { label: 'Manual review suggested', value: 64, tone: 'warning' }
  }
  if (['high', 'high-risk', 'blocked', 'rejected'].includes(value)) {
    return { label: 'High risk', value: 100, tone: 'danger' }
  }
  if (['error', 'failed'].includes(value))
    return { label: 'Screening could not finish', value: 100, tone: 'danger' }
  if (['complete', 'completed', 'approved'].includes(value))
    return { label: 'Screening complete', value: 100, tone: 'success' }
  return { label: 'Waiting to start', value: 0, tone: 'neutral' }
}

export function RiskProgress({
  status,
  message,
  progress,
  label = 'Risk screening',
  className,
  ...props
}: RiskProgressProps) {
  const meta = riskMeta(status)
  const percent = typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : meta.value

  return (
    <div
      className={classNames('risk-progress', `risk-progress--${meta.tone}`, className)}
      aria-live="polite"
      {...props}
    >
      <div className="risk-progress__heading">
        <span className="risk-progress__label">{label}</span>
        <span className="risk-progress__state">{meta.label}</span>
      </div>
      <div
        className="risk-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meta.indeterminate ? undefined : percent}
        aria-valuetext={message ?? meta.label}
      >
        <span
          className={classNames(
            'risk-progress__bar',
            meta.indeterminate && 'risk-progress__bar--indeterminate',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {message ? <p className="risk-progress__message">{message}</p> : null}
    </div>
  )
}
