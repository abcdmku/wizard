import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'
import { Alert } from './Feedback'
import { Button } from './Surface'

export interface ReviewSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  onEdit?: () => void
  editLabel?: string
  invalidated?: boolean | string
}

export function ReviewSection({
  title,
  onEdit,
  editLabel = 'Edit',
  invalidated = false,
  children,
  className,
  ...props
}: ReviewSectionProps) {
  const warning =
    typeof invalidated === 'string'
      ? invalidated
      : 'A prior answer changed. Review this section before submitting.'
  const titleText = typeof title === 'string' ? title : 'this section'

  return (
    <section
      className={classNames('review-section', invalidated && 'review-section--invalid', className)}
      {...props}
    >
      <header className="review-section__header">
        <h2 className="review-section__title">{title}</h2>
        {onEdit ? (
          <Button
            variant="quiet"
            size="small"
            onClick={onEdit}
            aria-label={`${editLabel} ${titleText}`}
          >
            {editLabel}
          </Button>
        ) : null}
      </header>
      {invalidated ? (
        <Alert tone="warning" title="Review needed">
          {warning}
        </Alert>
      ) : null}
      <div className="review-section__body">{children}</div>
    </section>
  )
}
