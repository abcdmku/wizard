import { Link } from '@tanstack/react-router'
import type { MDXComponents } from 'mdx/types'
import { type ComponentPropsWithoutRef, useRef } from 'react'
import { withBase } from '../../lib/site'
import { RunDiagram } from '../run-diagram/run-diagram'
import { Sequence } from '../sequence/sequence'
import { CopyButton } from './copy-button'
import { Table } from './table'

/** Docs routes navigate client-side; generated files use base-prefixed ordinary anchors. */
function MdxAnchor({ href, children, className, title }: ComponentPropsWithoutRef<'a'>) {
  if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
    const [pathAndQuery = '', hash] = href.split('#')
    const [path = '', query] = pathAndQuery.split('?')
    const slug = path.replace(/^\/+/, '').replace(/\/+$/, '')
    if (slug === 'typedoc' || slug.startsWith('typedoc/') || slug.startsWith('pagefind/')) {
      return (
        <a href={withBase(href)} className={className} title={title}>
          {children}
        </a>
      )
    }
    const shared = { className, title, ...(hash ? { hash } : {}) }
    if (slug === 'playground') {
      const search = Object.fromEntries(new URLSearchParams(query ?? ''))
      return (
        <Link to="/playground" search={search} {...shared}>
          {children}
        </Link>
      )
    }
    if (slug === '') {
      return (
        <Link to="/" {...shared}>
          {children}
        </Link>
      )
    }
    return (
      <Link to="/$" params={{ _splat: slug }} {...shared}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  )
}

/**
 * Every code block gets a copy button (reads the rendered text so highlighting is irrelevant).
 * It shows on hover or keyboard focus, and always on a touch screen, which has no hover.
 */
function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="code-block relative">
      <pre ref={ref} {...props} />
      <CopyButton
        text={() => ref.current?.textContent ?? ''}
        className="code-copy absolute right-2 top-2"
        label="Copy code"
      />
    </div>
  )
}

export const mdxComponents: MDXComponents = {
  a: MdxAnchor,
  pre: Pre,
  table: Table,
  RunDiagram,
  Sequence,
}
