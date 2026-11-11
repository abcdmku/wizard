import type { ReactNode } from 'react'

import { HttpError } from '../api/http'
import { Alert, Card } from '../components'

export function errorMessage(error: unknown): string {
  if (error instanceof HttpError && error.body && typeof error.body === 'object') {
    if ('message' in error.body && typeof error.body.message === 'string') {
      return error.body.message
    }
    if ('issues' in error.body && Array.isArray(error.body.issues)) {
      const messages = error.body.issues.flatMap((issue) => {
        if (issue && typeof issue === 'object' && 'message' in issue) {
          return typeof issue.message === 'string' ? [issue.message] : []
        }
        return []
      })
      if (messages.length > 0) return messages.join(' ')
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Something went wrong. Try again in a moment.'
}

export function LoadingCard({
  children = 'Loading your application...',
}: {
  children?: ReactNode
}) {
  return (
    <Card>
      <div className="loading-row" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{children}</span>
      </div>
    </Card>
  )
}

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="danger" title="We couldn't load this page">
      <p>{errorMessage(error)}</p>
      {onRetry ? (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </Alert>
  )
}
