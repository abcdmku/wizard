import type { Dashboard } from '../model'
import { Icon, type IconName } from './Icon'

interface MetricStripProps {
  dashboard: Dashboard
}

export function MetricStrip({ dashboard }: MetricStripProps) {
  const active = dashboard.deliveries.filter((item) =>
    ['pending', 'in_transit', 'delayed'].includes(item.status),
  ).length
  const moving = dashboard.vehicles.filter((item) =>
    ['en_route', 'delayed'].includes(item.status),
  ).length
  const urgent = dashboard.escalations.filter((item) =>
    ['critical', 'high'].includes(item.severity),
  ).length
  const completed = dashboard.deliveries.filter((item) => item.status === 'completed').length

  const metrics: Array<{
    label: string
    value: number
    icon: IconName
    urgent?: boolean
  }> = [
    { label: 'Active deliveries', value: active, icon: 'box' },
    { label: 'Vehicles moving', value: moving, icon: 'truck' },
    { label: 'Urgent queue', value: urgent, icon: 'alert', urgent: true },
    { label: 'Completed today', value: completed, icon: 'check' },
  ]

  return (
    <section className="metric-strip" aria-label="Dispatch summary">
      {metrics.map((metric) => (
        <article
          className={metric.urgent && metric.value ? 'metric urgent' : 'metric'}
          key={metric.label}
        >
          <span className="metric-icon">
            <Icon name={metric.icon} />
          </span>
          <span>
            <strong>{metric.value.toString().padStart(2, '0')}</strong>
            <small>{metric.label}</small>
          </span>
        </article>
      ))}
    </section>
  )
}
