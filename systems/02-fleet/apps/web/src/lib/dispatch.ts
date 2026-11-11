import type { Dashboard, Delivery, Escalation } from '../model'

const severityRank: Record<Escalation['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function sortEscalations(items: readonly Escalation[]): Escalation[] {
  return [...items].sort((left, right) => {
    return (
      right.score - left.score ||
      severityRank[left.severity] - severityRank[right.severity] ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    )
  })
}

export function deliveryById(dashboard: Dashboard, id: string | undefined): Delivery | undefined {
  return dashboard.deliveries.find((delivery) => delivery.id === id)
}

export function hasColdChainBreach(delivery: Delivery): boolean {
  const { coldChain, maxC, minC, tempC } = delivery.cargo
  if (!coldChain || tempC === undefined) return false
  return (minC !== undefined && tempC < minC) || (maxC !== undefined && tempC > maxC)
}

export function formatClock(value: string, timezone: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Time unavailable'
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
