import { MDXProvider } from '@mdx-js/react'
import { createFileRoute } from '@tanstack/react-router'
import { mdxComponents } from '../../mdx-components'
import IndexPage from '../../pages/index.mdx'

export const Route = createFileRoute('/')({
  component: LandingRoute,
})

function LandingRoute() {
  return (
    <MDXProvider components={mdxComponents}>
      <IndexPage />
    </MDXProvider>
  )
}
