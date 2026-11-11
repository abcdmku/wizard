import type { DisplayStatus } from './contracts'

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function statusLabel(status: DisplayStatus): string {
  const labels: Record<DisplayStatus, string> = {
    processing: 'Processing',
    fraud_review: 'Needs review',
    shipping: 'Shipping',
    shipped: 'Shipped',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    failed: 'Failed',
    compensating: 'Reversing',
    queued: 'Queued',
    running: 'Running',
    waiting: 'Waiting',
    succeeded: 'Complete',
    compensated: 'Reversed',
  }
  return labels[status]
}

export function statusTone(status: DisplayStatus): string {
  if (['succeeded', 'shipped'].includes(status)) return 'success'
  if (['failed'].includes(status)) return 'danger'
  if (['fraud_review', 'waiting', 'compensating', 'cancelling'].includes(status)) {
    return 'warning'
  }
  if (['running', 'processing', 'shipping'].includes(status)) return 'active'
  return 'neutral'
}
