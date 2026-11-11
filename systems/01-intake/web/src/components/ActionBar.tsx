import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  primaryAction?: ReactNode
  secondaryActions?: ReactNode
  status?: ReactNode
  sticky?: boolean
}

export function ActionBar({
  primaryAction,
  secondaryActions,
  status,
  sticky = false,
  children,
  className,
  ...props
}: ActionBarProps) {
  return (
    <div className={classNames('action-bar', sticky && 'action-bar--sticky', className)} {...props}>
      {status ? <div className="action-bar__status">{status}</div> : null}
      <div className="action-bar__controls">
        {secondaryActions ? <div className="action-bar__secondary">{secondaryActions}</div> : null}
        {primaryAction || children ? (
          <div className="action-bar__primary">{primaryAction ?? children}</div>
        ) : null}
      </div>
    </div>
  )
}
