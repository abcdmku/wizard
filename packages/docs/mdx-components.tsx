import type { MDXComponents } from 'mdx/types.js'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
  }
}
