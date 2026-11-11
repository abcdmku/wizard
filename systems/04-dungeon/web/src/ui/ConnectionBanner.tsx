import type { SocketStatus } from '../network/useDungeonSocket'

interface ConnectionBannerProps {
  state: SocketStatus
  retryInMs: number | null
  message: string | null
  onRetry: () => void
  onLeave: () => void
}

export const ConnectionBanner = ({
  state,
  retryInMs,
  message,
  onRetry,
  onLeave,
}: ConnectionBannerProps) => {
  if (state === 'connected') {
    return (
      <span className="visually-hidden" data-testid="connection-status">
        Connected
      </span>
    )
  }
  const retrySeconds = retryInMs === null ? null : Math.max(1, Math.ceil(retryInMs / 1_000))
  const title =
    state === 'rejected'
      ? 'Ticket rejected'
      : state === 'offline'
        ? 'You are offline'
        : 'Reconnecting'
  return (
    <aside className="connection-banner" data-testid="connection-status" aria-live="assertive">
      <span className="connection-pip" aria-hidden="true" />
      <div>
        <strong>{state === 'connecting' ? 'Joining party' : title}</strong>
        <span>
          {message ??
            (retrySeconds === null ? 'Contacting the dungeon...' : `Retrying in ${retrySeconds}s`)}
        </span>
      </div>
      {(state === 'offline' || state === 'rejected') && (
        <button type="button" onClick={state === 'rejected' ? onLeave : onRetry}>
          {state === 'rejected' ? 'Use another ticket' : 'Retry now'}
        </button>
      )}
    </aside>
  )
}
