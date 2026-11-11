import type { ConnectionPhase } from '../hooks/useFleetFeed'
import { formatClock } from '../lib/dispatch'
import type { Dashboard } from '../model'
import { Icon } from './Icon'

const phaseText: Record<ConnectionPhase, string> = {
  loading: 'Loading',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  failed: 'Connection failed',
}

interface DispatchHeaderProps {
  dashboard: Dashboard
  phase: ConnectionPhase
  retryCount: number
  onLogout: () => void
}

export function DispatchHeader({ dashboard, phase, retryCount, onLogout }: DispatchHeaderProps) {
  const connectionLabel =
    phase === 'reconnecting' && retryCount > 0
      ? `${phaseText[phase]} · attempt ${retryCount}`
      : phaseText[phase]

  return (
    <header className="dispatch-header">
      <div className="header-brand">
        <span className="brand-mark brand-mark-small" aria-hidden="true">
          <Icon name="route" />
        </span>
        <span>
          <strong>OpenWizard</strong>
          <small>Fleet control</small>
        </span>
      </div>
      <div className="tenant-heading">
        <span className="eyebrow">Active network</span>
        <h1>{dashboard.tenant.name}</h1>
      </div>
      <div className="header-actions">
        <div className={`connection-pill connection-${phase}`} role="status" aria-live="polite">
          <span className="connection-dot" aria-hidden="true" />
          <span>{connectionLabel}</span>
          <small>{formatClock(dashboard.generatedAt, dashboard.tenant.timezone)}</small>
        </div>
        <button className="icon-button logout-button" onClick={onLogout} type="button">
          <Icon name="logout" />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
    </header>
  )
}
