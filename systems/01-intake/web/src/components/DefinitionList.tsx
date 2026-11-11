import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export interface DefinitionItem {
  id?: string
  term: ReactNode
  detail: ReactNode
}

export interface DefinitionListProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly DefinitionItem[]
  columns?: 1 | 2 | 3
}

export function DefinitionList({ items, columns = 2, className, ...props }: DefinitionListProps) {
  return (
    <dl
      className={classNames('definition-list', `definition-list--${columns}`, className)}
      {...props}
    >
      {items.map((item) => (
        <div className="definition-list__item" key={item.id ?? String(item.term)}>
          <dt>{item.term}</dt>
          <dd>{item.detail}</dd>
        </div>
      ))}
    </dl>
  )
}
