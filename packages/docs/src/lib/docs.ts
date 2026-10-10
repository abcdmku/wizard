import { type DocsPage, docsNavItems, docsPages, docsSections } from 'virtual:docs-manifest'
import { type ComponentType, lazy } from 'react'

export type { DocsPage, DocsSection } from 'virtual:docs-manifest'
export { docsNavItems, docsPages, docsSections }

export const docsPageMap: ReadonlyMap<string, DocsPage> = new Map(
  docsPages.map((page) => [page.slug, page]),
)

export function normalizeSlug(value: string | undefined): string {
  return (value ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/index$/, '')
}

export function pageBySlug(slug: string | undefined): DocsPage | undefined {
  return docsPageMap.get(normalizeSlug(slug))
}

/** The page before (`-1`) or after (`1`) `slug` in reading order. */
export function siblingPage(slug: string, offset: -1 | 1): DocsPage | undefined {
  const index = docsPages.findIndex((page) => page.slug === normalizeSlug(slug))
  return index === -1 ? undefined : docsPages[index + offset]
}

// ---------------------------------------------------------------------------
// MDX modules: one lazy chunk per page, cached once loaded so the route can render synchronously.
// ---------------------------------------------------------------------------

type MdxModule = { readonly default: ComponentType }

const importers = import.meta.glob<MdxModule>('../../pages/**/*.mdx')
const loaded = new Map<string, MdxModule>()
const pending = new Map<string, Promise<MdxModule>>()

export function hasPageModule(modulePath: string): boolean {
  return modulePath in importers
}

export function loadPageModule(modulePath: string): Promise<MdxModule> {
  const cached = loaded.get(modulePath)
  if (cached) return Promise.resolve(cached)
  const inFlight = pending.get(modulePath)
  if (inFlight) return inFlight
  const importer = importers[modulePath]
  if (!importer) return Promise.reject(new Error(`Unknown docs module: ${modulePath}`))
  const promise = importer()
    .then((mod) => {
      loaded.set(modulePath, mod)
      return mod
    })
    .finally(() => pending.delete(modulePath))
  pending.set(modulePath, promise)
  return promise
}

export function loadedPageModule(modulePath: string): MdxModule | undefined {
  return loaded.get(modulePath)
}

const lazyPages = new Map<string, ComponentType>()

/**
 * The page component for a module. Synchronous when the loader already loaded it (server render,
 * client-side navigation); otherwise a `React.lazy` wrapper — during hydration the client cache
 * is empty because loader data is dehydrated, and the lazy component keeps the server-rendered
 * HTML on screen (inside the route's Suspense boundary) until the chunk arrives.
 */
export function pageComponent(modulePath: string): ComponentType {
  const ready = loaded.get(modulePath)?.default
  if (ready) return ready
  let lazyPage = lazyPages.get(modulePath)
  if (!lazyPage) {
    lazyPage = lazy(() => loadPageModule(modulePath))
    lazyPages.set(modulePath, lazyPage)
  }
  return lazyPage
}

export function prefetchPage(slug: string | undefined): void {
  const page = pageBySlug(slug)
  if (page) void loadPageModule(page.modulePath).catch(() => undefined)
}
