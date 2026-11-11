import { Database, Headphones, PackageCheck, RefreshCw, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'

export type AppRole = 'customer' | 'operator'

export function AppShell({
  role,
  onRoleChange,
  isDemo,
  refreshing,
  onRefresh,
  children,
}: {
  role: AppRole
  onRoleChange: (role: AppRole) => void
  isDemo: boolean
  refreshing: boolean
  onRefresh: () => void
  children: ReactNode
}) {
  return (
    <div className={`app-shell role-${role}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <a className="brand" href="/" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark" aria-hidden="true">
            <PackageCheck size={20} />
          </span>
          <span>
            <strong>Fulfill</strong>
            <small>LocalStack reference</small>
          </span>
        </a>
        <nav className="role-switcher" aria-label="Choose view">
          <button
            type="button"
            className={role === 'customer' ? 'active' : ''}
            aria-pressed={role === 'customer'}
            onClick={() => onRoleChange('customer')}
          >
            <UserRound size={16} aria-hidden="true" />
            Customer
          </button>
          <button
            type="button"
            className={role === 'operator' ? 'active' : ''}
            aria-pressed={role === 'operator'}
            onClick={() => onRoleChange('operator')}
          >
            <Headphones size={16} aria-hidden="true" />
            Operator
          </button>
        </nav>
        <div className="header-tools">
          <span className={`environment-chip ${isDemo ? '' : 'environment-live'}`}>
            <Database size={13} aria-hidden="true" />
            {isDemo ? 'Seeded demo' : 'API connected'}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh orders"
            title="Refresh orders"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? 'spin' : ''} size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
