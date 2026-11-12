import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SiteHeader } from '../site-header'
import { Ide } from './ide'
import { allSamples, landingSample, type PlaygroundSample } from './samples'
import { usePlayground } from './use-playground'

/** `/playground?example=11-order-workflow` opens with the backend order example loaded. */
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
  const navigate = useNavigate()
  const playground = usePlayground(requestedSample(search))
  const { sample, loadSample } = playground

  // Follow the URL (back/forward, links from the examples pages); editing never reloads a sample.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the URL should trigger a reload
  useEffect(() => {
    const wanted = requestedSample(search)
    if (wanted.id !== sample.id) loadSample(wanted)
  }, [search])

  // The picker changes the address, so the example on screen is the one a copied link opens.
  const pickSample = (picked: PlaygroundSample) => {
    void navigate({
      to: '/playground',
      search: picked.id === landingSample.id ? {} : { example: picked.id },
      replace: true,
    })
  }

  return (
    <div className="flex h-dvh min-h-[30rem] flex-col">
      <SiteHeader />
      <main className="min-h-0 flex-1 p-2 sm:p-3 lg:p-4">
        <h1 className="sr-only">Playground</h1>
        <Ide
          state={playground}
          title="Playground"
          subtitle="runs against the real @openwizard/core"
          samples={allSamples}
          currentSampleId={sample.id}
          onPickSample={pickSample}
          previewClassName="@2xl/ide:w-1/2 @5xl/ide:w-[42%]"
        />
      </main>
    </div>
  )
}
