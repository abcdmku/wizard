import { createFileRoute } from '@tanstack/react-router'
import { PlaygroundPage } from '../components/playground/playground-page'
import { site } from '../lib/site'

export const Route = createFileRoute('/playground')({
  head: () => ({ meta: [{ title: `Playground | ${site.name}` }] }),
  // `?example=11-order-workflow` names the example to open. Anything else is dropped.
  validateSearch: (search: Record<string, unknown>): { example?: string } =>
    typeof search.example === 'string' ? { example: search.example } : {},
  component: PlaygroundPage,
})
