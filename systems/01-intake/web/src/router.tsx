import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'

import { AppShell, Card } from './components'
import { ApplicantStepRoute, ApplicationIndex } from './routes/applicant'
import { HomePage } from './routes/home'
import { ReviewerApplicationPage, ReviewerQueuePage } from './routes/reviewer'

function RootLayout() {
  const audience = useRouterState({
    select: (state) => (state.location.pathname.startsWith('/reviewer') ? 'reviewer' : 'applicant'),
  })

  return (
    <AppShell audience={audience}>
      <Outlet />
    </AppShell>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="portal-page">
      <Card>
        <p className="eyebrow">404</p>
        <h1>That page isn't part of this application</h1>
        <p>Return to the demo account chooser to open an applicant or reviewer workspace.</p>
        <Link className="button button--primary" to="/">
          Go to demo accounts
        </Link>
      </Card>
    </div>
  ),
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const applicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apply/$applicationId',
  component: Outlet,
})

const applicationIndexRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: '/',
  component: ApplicationIndex,
})

const applicantStepRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: '$step',
  component: ApplicantStepRoute,
})

const reviewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviewer',
  component: ReviewerQueuePage,
})

const reviewerApplicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviewer/$applicationId',
  component: ReviewerApplicationPage,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  applicationRoute.addChildren([applicationIndexRoute, applicantStepRoute]),
  reviewerRoute,
  reviewerApplicationRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
