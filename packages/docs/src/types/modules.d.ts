declare module '*.mdx' {
  import type { ComponentType } from 'react'

  const MdxComponent: ComponentType<Record<string, unknown>>
  export default MdxComponent
}

declare module '*.md' {
  import type { ComponentType } from 'react'

  const MdComponent: ComponentType<Record<string, unknown>>
  export default MdComponent
}

declare module 'virtual:docs-manifest' {
  export interface DocsPage {
    readonly slug: string
    readonly path: string
    readonly title: string
    readonly sourcePath: string
    readonly modulePath: string
    readonly section: string | null
    readonly order: number
  }
  export interface DocsSection {
    readonly id: string
    readonly title: string
    readonly slugs: readonly string[]
  }
  export type DocsNavItem =
    | { readonly type: 'page'; readonly slug: string }
    | { readonly type: 'section'; readonly id: string }
  export const docsPages: readonly DocsPage[]
  export const docsSections: readonly DocsSection[]
  export const docsNavItems: readonly DocsNavItem[]
}

declare module 'virtual:monaco-libs' {
  /** `file:///node_modules/…` URI → declaration file contents. */
  export const monacoLibs: Readonly<Record<string, string>>
}
