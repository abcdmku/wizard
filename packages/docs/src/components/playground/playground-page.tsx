import { useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SiteHeader } from '../site-header'
import { Ide } from './ide'
import { allSamples, landingSample } from './samples'
import { usePlayground } from './use-playground'

/** `/playground?example=07-dag-pipeline` opens with that example loaded. */
function requestedSample(search: unknown) {
  const id =
    typeof search === 'object' &&
    search !== null &&
    'example' in search &&
    typeof search.example === 'string'
      ? search.example
      : null
  return allSamples.find((sample) => sample.id === id) ?? landingSample
}

/** Full-height IDE with the example picker; every example runs verbatim in the browser. */
export function PlaygroundPage() {
  const search = useSearch({ strict: false })
  const playground = usePlayground(requestedSample(search))
  const { sample, loadSample } = playground

  // Follow the URL (back/forward, links from the examples pages); editing never reloads a sample.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the URL should trigger a reload
  useEffect(() => {
    const wanted = requestedSample(search)
    if (wanted.id !== sample.id) loadSample(wanted)
  }, [search])

  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader />
      <main className="min-h-0 flex-1 p-3 lg:p-4">
        <Ide
          state={playground}
          title="Playground · runs against the real @openwizard/core"
          samples={allSamples}
          currentSampleId={sample.id}
          previewClassName="lg:w-[42%] xl:w-[44%]"
        />
      </main>
    </div>
  )
}
