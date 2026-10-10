import { createFileRoute } from '@tanstack/react-router'
import { PlaygroundPage } from '../components/playground/playground-page'
import { site } from '../lib/site'

export const Route = createFileRoute('/playground')({
  head: () => ({ meta: [{ title: `Playground — ${site.name}` }] }),
  component: PlaygroundPage,
})
