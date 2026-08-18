import { MDXProvider } from '@mdx-js/react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
import { DocsLayout } from '../components/docs-layout'
import { mdxComponents } from '../components/mdx/mdx-components'
import {
  hasPageModule,
  loadPageModule,
  pageBySlug,
  pageComponent,
  prefetchPage,
  siblingPage,
} from '../lib/docs'
import { site } from '../lib/site'

export const Route = createFileRoute('/$')({
  loader: async ({ params }) => {
    const page = pageBySlug(params._splat)
    if (!page || !hasPageModule(page.modulePath)) throw notFound()
    await loadPageModule(page.modulePath)
    return { page }
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `${loaderData.page.title} — ${site.name}` }] : [],
  }),
  component: DocsPageRoute,
})

function DocsPageRoute() {
  const { page } = Route.useLoaderData()
  const MdxPage = pageComponent(page.modulePath)

  useEffect(() => {
    prefetchPage(siblingPage(page.slug, -1)?.slug)
    prefetchPage(siblingPage(page.slug, 1)?.slug)
  }, [page.slug])

  return (
    <DocsLayout page={page}>
      <MDXProvider components={mdxComponents}>
        <Suspense fallback={null}>
          <MdxPage key={page.slug} />
        </Suspense>
      </MDXProvider>
    </DocsLayout>
  )
}
