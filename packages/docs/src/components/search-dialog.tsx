import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

interface SearchHit {
  readonly id: string
  readonly title: string
  readonly excerpt: string
  readonly url: string
}

interface PagefindResult {
  readonly id: string
  data(): Promise<{
    readonly excerpt: string
    readonly meta: { readonly title?: string }
    readonly url: string
  }>
}

interface Pagefind {
  search(query: string): Promise<{ readonly results: readonly PagefindResult[] }>
}

let pagefindPromise: Promise<Pagefind> | null = null

/** The Pagefind bundle is produced by `postbuild.mjs` over the prerendered HTML (absent in dev). */
function loadPagefind(): Promise<Pagefind> {
  pagefindPromise ??= import(
    /* @vite-ignore */ `${import.meta.env.BASE_URL}pagefind/pagefind.js`
  ) as Promise<Pagefind>
  return pagefindPromise
}

async function runSearch(query: string): Promise<readonly SearchHit[]> {
  const pagefind = await loadPagefind()
  const { results } = await pagefind.search(query)
  return Promise.all(
    results.slice(0, 8).map(async (result) => {
      const data = await result.data()
      return {
        id: result.id,
        title: data.meta.title ?? data.url,
        excerpt: data.excerpt,
        url: data.url,
      }
    }),
  )
}

/** Header search button + modal; `/` opens it, `Escape` closes it. */
export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !typing) {
        event.preventDefault()
        setOpen(true)
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([])
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    runSearch(query.trim())
      .then((found) => {
        if (cancelled) return
        setHits(found)
        setStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, query])

  const hint =
    status === 'loading'
      ? 'Searching…'
      : status === 'error'
        ? 'The search index is built with the site (pnpm docs:build); it is not available in dev.'
        : query.trim().length < 2
          ? 'Type at least two characters'
          : hits.length === 0
            ? 'No matches'
            : `${hits.length} result${hits.length === 1 ? '' : 's'}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-neutral-200 px-1 font-mono text-[10px] sm:inline dark:border-neutral-700">
          /
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search the docs"
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-ink-2"
          >
            <input
              // biome-ignore lint/a11y/noAutofocus: a search dialog should focus its input when opened
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the docs…"
              className="w-full border-b border-neutral-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-neutral-800"
            />
            <div className="max-h-[60vh] overflow-y-auto">
              <p className="px-4 py-2 text-xs text-neutral-500">{hint}</p>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <a
                      // Pagefind resolves result URLs against its bundle location, so they already carry the base.
                      href={hit.url}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {hit.title}
                      </div>
                      <div
                        className="mt-0.5 text-xs leading-5 text-neutral-500"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: Pagefind excerpts are generated from our own prerendered pages
                        dangerouslySetInnerHTML={{ __html: hit.excerpt }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
