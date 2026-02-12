import { useEffect, useState } from 'react'
import { MDXProvider } from '@mdx-js/react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsLayout } from '@/components/docs-layout'
import { getDocPageBySlug, getDocSibling } from '@/lib/docs'
import {
  getLoadedDocModule,
  hasDocModule,
  loadDocModule,
  prefetchDocModuleBySlug,
} from '@/lib/docs-modules'
import { mdxComponents } from '../../mdx-components'

export const Route = createFileRoute('/$')({
  loader: async ({ params }) => {
    const page = getDocPageBySlug(params._splat)
    if (!page || !hasDocModule(page.modulePath)) {
      throw notFound()
    }

    await loadDocModule(page.modulePath)

    return { page }
  },
  component: CatchAllDocsRoute,
})

function CatchAllDocsRoute() {
  const { page } = Route.useLoaderData()
  const [reloadKey, setReloadKey] = useState(0)
  const modulePath = page.modulePath
  const loadedModule = getLoadedDocModule(modulePath)
  const MdxPage = loadedModule?.default

  useEffect(() => {
    prefetchDocModuleBySlug(getDocSibling(page.slug, -1)?.slug)
    prefetchDocModuleBySlug(getDocSibling(page.slug, 1)?.slug)
  }, [page.slug])

  useEffect(() => {
    if (loadedModule) {
      return
    }

    let cancelled = false
    void loadDocModule(modulePath).then(() => {
      if (!cancelled) {
        setReloadKey((value) => value + 1)
      }
    })

    return () => {
      cancelled = true
    }
  }, [loadedModule, modulePath])

  return (
    <DocsLayout page={page}>
      {MdxPage ? (
        <MDXProvider components={mdxComponents}>
          <MdxPage key={page.slug} />
        </MDXProvider>
      ) : (
        <div key={`${modulePath}-${reloadKey}`} className="py-8 text-sm text-slate-500">
          Loading page...
        </div>
      )}
    </DocsLayout>
  )
}
