import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone
  title: ReactNode
}

const ALERT_MARKS: Record<AlertTone, string> = {
  info: 'i',
  success: '\u2713',
  warning: '!',
  danger: '!',
}

export function Alert({ tone = 'info', title, children, className, ...props }: AlertProps) {
  return (
    <div
      className={classNames('alert', `alert--${tone}`, className)}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      {...props}
    >
      <span className="alert__mark" aria-hidden="true">
        {ALERT_MARKS[tone]}
      </span>
      <div className="alert__content">
        <p className="alert__title">{title}</p>
        {children ? <div className="alert__body">{children}</div> : null}
      </div>
    </div>
  )
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string
  label?: string
  tone?: BadgeTone
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  'in-progress': 'In progress',
  prefilling: 'Prefilling',
  'eligibility-pending': 'Checking eligibility',
  'standard-financials': 'Standard financials',
  'hardship-evidence': 'Hardship evidence',
  appeal: 'Appeal',
  documents: 'Documents',
  review: 'Review',
  'risk-review': 'Risk review',
  'awaiting-reviewer': 'Awaiting reviewer',
  ready: 'Ready',
  submitted: 'Submitted',
  'under-review': 'Under review',
  'needs-information': 'Needs information',
  approved: 'Approved',
  rejected: 'Rejected',
  declined: 'Declined',
  'changes-requested': 'Changes requested',
  cancelled: 'Cancelled',
  failed: 'Failed',
  pending: 'Pending',
  'low-risk': 'Low risk',
  'medium-risk': 'Medium risk',
  'high-risk': 'High risk',
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  error: 'Error',
}

function normalizeStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function statusTone(status: string): BadgeTone {
  if (['approved', 'ready', 'complete', 'low', 'low-risk'].includes(status)) return 'success'
  if (
    [
      'submitted',
      'under-review',
      'in-progress',
      'loading',
      'prefilling',
      'eligibility-pending',
      'standard-financials',
      'documents',
      'review',
      'risk-review',
    ].includes(status)
  )
    return 'info'
  if (
    [
      'pending',
      'needs-information',
      'medium',
      'medium-risk',
      'hardship-evidence',
      'appeal',
      'awaiting-reviewer',
      'changes-requested',
    ].includes(status)
  )
    return 'warning'
  if (['declined', 'rejected', 'error', 'failed', 'high', 'high-risk', 'blocked'].includes(status))
    return 'danger'
  return 'neutral'
}

function readableStatus(status: string): string {
  return status
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function StatusBadge({ status, label, tone, className, ...props }: StatusBadgeProps) {
  const normalized = normalizeStatus(status)
  const badgeTone = tone ?? statusTone(normalized)
  return (
    <span
      className={classNames('status-badge', `status-badge--${badgeTone}`, className)}
      {...props}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {label ?? STATUS_LABELS[normalized] ?? readableStatus(normalized)}
    </span>
  )
}
