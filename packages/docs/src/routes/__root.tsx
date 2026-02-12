import React from 'react'
import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { siteConfig } from '@/config/site'
import { ThemeProvider } from '@/theme/theme-provider'
import docsCss from '../../styles/global.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: `${siteConfig.title} Documentation` },
      { name: 'description', content: siteConfig.description },
      {
        name: 'keywords',
        content: 'typescript, react, wizard, multi-step, form, state management, type-safe',
      },
    ],
    links: [
      { rel: 'stylesheet', href: docsCss },
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>W</text></svg>',
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-2 text-3xl font-bold">Page not found</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
        The page you requested does not exist in the docs map.
      </p>
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="rounded-md border border-slate-200 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          Home
        </Link>
        <Link
          to="/$"
          params={{ _splat: 'getting-started' }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Getting Started
        </Link>
      </div>
    </main>
  )
}
