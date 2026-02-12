import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function resolveBasepath() {
  const base = import.meta.env.BASE_URL || '/'
  if (base === '/') return undefined
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    basepath: resolveBasepath(),
    scrollRestoration: true,
    defaultPreload: 'intent',
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
