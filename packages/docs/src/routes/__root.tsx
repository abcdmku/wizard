import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { site } from '../lib/site'
import globalCss from '../styles/global.css?url'
import { ThemeProvider, themeBootScript } from '../theme/theme-provider'

// The same wand and spark as the header mark, on a dark tile.
const FAVICON =
  'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%227%22 fill=%22%230a0a0a%22/><path d=%22M7.5 24.5L17 15%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22/><path d=%22M21.5 4.5Q22.3 9.7 27.5 10.5Q22.3 11.3 21.5 16.5Q20.7 11.3 15.5 10.5Q20.7 9.7 21.5 4.5Z%22 fill=%22white%22/></svg>'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: `${site.name} | TypeScript workflows` },
      { name: 'description', content: site.description },
    ],
    links: [
      { rel: 'stylesheet', href: globalCss },
      { rel: 'icon', href: FAVICON },
    ],
    scripts: [{ children: themeBootScript }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs text-neutral-500">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-neutral-500">There is no page at this address.</p>
      <div className="mt-6 flex gap-4 text-sm">
        <Link to="/" className="underline underline-offset-4">
          Home
        </Link>
        <Link to="/$" params={{ _splat: 'quickstart' }} className="underline underline-offset-4">
          Quickstart
        </Link>
      </div>
    </main>
  )
}
