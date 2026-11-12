import {
  Children,
  type ComponentPropsWithoutRef,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

type WithChildren = { readonly children?: ReactNode }

const elements = (node: ReactNode): ReactElement<WithChildren>[] =>
  Children.toArray(node).filter((child): child is ReactElement<WithChildren> =>
    isValidElement(child),
  )

/** Plain text of a rendered node, so a header such as "Option of `view`" becomes a label. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<WithChildren>(node)) return textOf(node.props.children)
  return ''
}

/**
 * On a phone each row is stacked, so the header row no longer sits above its columns.
 * Copy each header onto the cells below it, from the second column on, as `data-label`.
 */
function labelCells(children: ReactNode): ReactNode {
  const sections = elements(children)
  const headRow = elements(sections.find((s) => s.type === 'thead')?.props.children)[0]
  const labels = elements(headRow?.props.children).map((th) => textOf(th.props.children))
  if (labels.length < 3) return children
  return sections.map((section) => {
    if (section.type !== 'tbody') return section
    const rows = elements(section.props.children).map((row) =>
      cloneElement(
        row,
        undefined,
        elements(row.props.children).map((cell, column) =>
          column === 0
            ? cell
            : cloneElement(cell as ReactElement<Record<string, unknown>>, {
                'data-label': labels[column],
              }),
        ),
      ),
    )
    return cloneElement(section, undefined, rows)
  })
}

/**
 * A table that scrolls sideways inside its own box on a wide screen and stacks each row
 * on a phone. Tables with three or more columns get a label on every stacked cell.
 */
export function Table({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props}>{labelCells(children)}</table>
    </div>
  )
}
