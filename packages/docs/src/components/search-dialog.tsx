import React, { useEffect, useMemo, useState } from 'react'
import { withBase } from '@/lib/base-path'

type SearchResult = {
  id: string
  title: string
  excerpt: string
  url: string
}

type PagefindResult = {
  id: string
  data: () => Promise<{
    excerpt: string
    meta: {
      title?: string
    }
    url: string
  }>
}

type PagefindResponse = {
  results: PagefindResult[]
}

type PagefindModule = {
  search: (query: string) => Promise<PagefindResponse>
}

let pagefindModulePromise: Promise<PagefindModule> | null = null

async function getPagefind() {
  if (!pagefindModulePromise) {
    const pagefindPath = `${import.meta.env.BASE_URL}pagefind/pagefind.js`
    pagefindModulePromise = import(/* @vite-ignore */ pagefindPath) as Promise<PagefindModule>
  }
  return pagefindModulePromise
}

function getAnchorHref(url: string) {
  if (url.startsWith('/')) {
    return withBase(url)
  }
  return url
}

export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable

      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget) {
        event.preventDefault()
        setOpen(true)
        return
      }

      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let disposed = false

    async function runSearch() {
      if (!open || query.trim().length < 2) {
        setResults([])
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const pagefind = await getPagefind()
        const response = await pagefind.search(query.trim())
        const topResults = response.results.slice(0, 8)
        const hydrated = await Promise.all(
          topResults.map(async (result) => {
            const data = await result.data()
            return {
              id: result.id,
              title: data.meta.title ?? data.url,
              excerpt: data.excerpt,
              url: data.url,
            } satisfies SearchResult
          }),
        )

        if (!disposed) {
          setResults(hydrated)
        }
      } catch (searchError) {
        if (!disposed) {
          setResults([])
          setError('Search index is not ready. Run `pnpm --filter @wizard/docs build` first.')
        }
      } finally {
        if (!disposed) {
          setLoading(false)
        }
      }
    }

    void runSearch()

    return () => {
      disposed = true
    }
  }, [open, query])

  const hint = useMemo(() => {
    if (loading) return 'Searching...'
    if (error) return error
    if (query.trim().length < 2) return 'Type at least 2 characters'
    if (results.length === 0) return 'No matches'
    return `${results.length} result${results.length === 1 ? '' : 's'}`
  }, [error, loading, query, results.length])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        Search
        <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] dark:border-slate-700 dark:bg-slate-900">
          /
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 pt-16">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0d0d0d]">
            <div className="border-b border-slate-200 p-3 dark:border-slate-700">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search docs..."
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-[#111] dark:text-slate-100"
              />
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {hint}
              </div>

              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {results.map((result) => (
                  <li key={result.id}>
                    <a
                      href={getAnchorHref(result.url)}
                      className="block px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-900"
                      onClick={() => setOpen(false)}
                    >
                      <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {result.title}
                      </div>
                      <div
                        className="text-xs text-slate-600 dark:text-slate-300"
                        dangerouslySetInnerHTML={{ __html: result.excerpt }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end border-t border-slate-200 p-2 dark:border-slate-700">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
