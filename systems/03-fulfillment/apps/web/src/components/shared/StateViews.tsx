import { AlertTriangle, Box, RefreshCw } from 'lucide-react'

export function PageSkeleton({ operator = false }: { operator?: boolean }) {
  return (
    <div
      className={`page-skeleton ${operator ? 'operator-skeleton' : ''}`}
      role="status"
      aria-label="Loading orders"
    >
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-subtitle" />
      <div className="skeleton-layout">
        <div className="skeleton-card" />
        <div className="skeleton-card skeleton-detail" />
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Box size={22} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  )
}

export function ErrorBanner({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>Orders could not be refreshed.</strong>
        <span>{message}</span>
      </div>
      <button className="button button-quiet" type="button" onClick={retry}>
        <RefreshCw size={15} aria-hidden="true" />
        Retry
      </button>
    </div>
  )
}
