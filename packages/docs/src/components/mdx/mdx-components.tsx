import { Link } from '@tanstack/react-router'
import type { MDXComponents } from 'mdx/types'
import { type ComponentPropsWithoutRef, useRef } from 'react'
import { Badge, Callout, Step, Steps, Tab, Tabs } from './blocks'
import { CopyButton } from './copy-button'

/** Site-absolute links navigate client-side (and get the deployment base); others are plain anchors. */
function MdxAnchor({ href, children, className, title }: ComponentPropsWithoutRef<'a'>) {
  if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
    const [pathAndQuery = '', hash] = href.split('#')
    const [path = '', query] = pathAndQuery.split('?')
    const slug = path.replace(/^\/+/, '').replace(/\/+$/, '')
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

/** Every code block gets a copy button (reads the rendered text so highlighting is irrelevant). */
function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="code-block group relative">
      <pre ref={ref} {...props} />
      <CopyButton
        text={() => ref.current?.textContent ?? ''}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        label="Copy code"
      />
    </div>
  )
}

export const mdxComponents: MDXComponents = {
  a: MdxAnchor,
  pre: Pre,
  Badge,
  Callout,
  Steps,
  Step,
  Tabs,
  Tab,
}
