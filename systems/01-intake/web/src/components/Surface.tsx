import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'muted' | 'accent'
  padding?: 'normal' | 'compact' | 'none'
}

export function Card({ className, tone = 'default', padding = 'normal', ...props }: CardProps) {
  return (
    <section
      className={classNames(
        'card',
        `card--${tone}`,
        padding !== 'normal' && `card--${padding}`,
        className,
      )}
      {...props}
    />
  )
}

export interface SectionHeaderProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  action,
  as: Heading = 'h2',
  className,
}: SectionHeaderProps) {
  return (
    <header className={classNames('section-header', className)}>
      <div className="section-header__copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading className="section-header__title">{title}</Heading>
        {description ? <p className="section-header__description">{description}</p> : null}
      </div>
      {action ? <div className="section-header__action">{action}</div> : null}
    </header>
  )
}

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'small' | 'normal'
  loading?: boolean
  loadingLabel?: string
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'normal',
  loading = false,
  loadingLabel = 'Working...',
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames(
        'button',
        `button--${variant}`,
        size === 'small' && 'button--small',
        className,
      )}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {loading ? loadingLabel : children}
    </button>
  )
}
