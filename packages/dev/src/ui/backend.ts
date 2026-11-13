import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Action, ActionResult, Catalog, RunDetail, RunSummary, StartRequest } from '../wire'

/** A change the UI should refetch for: one run, or the catalog. */
export interface Notice {
  readonly run?: string
  readonly catalog?: true
}

/**
 * Where the UI gets its wizards and runs. `openwizard dev` answers over HTTP. A page that holds
 * the wizards itself answers from memory.
 */
export interface Backend {
  /** `server` when a dev server holds the runs, `page` when this page does. */
  readonly place: 'server' | 'page'
  catalog(): Promise<Catalog>
  /** Loads the entry file again. Absent when there is no file to load. */
  readonly reload?: () => Promise<Catalog>
  runs(): Promise<readonly RunSummary[]>
  run(id: string): Promise<RunDetail | undefined>
  start(request: StartRequest): Promise<ActionResult & { readonly id?: string }>
  act(id: string, action: Action): Promise<ActionResult>
  remove(id: string): Promise<boolean>
  /** Calls `onNotice` for every change and `onOpen` when the connection opens or drops. */
  subscribe(onNotice: (notice: Notice) => void, onOpen: (open: boolean) => void): () => void
}

const BackendContext = createContext<Backend | undefined>(undefined)

/** Gives the UI below it a backend. */
export const BackendProvider = BackendContext.Provider

/** The backend of the UI this component is in. */
export function useBackend(): Backend {
  const backend = useContext(BackendContext)
  if (backend === undefined) throw new Error('The dev UI needs a backend.')
  return backend
}

/** The catalog and the run list, refreshed when the backend reports a change. */
export function useServer(): {
  readonly catalog: Catalog | undefined
  readonly runs: readonly RunSummary[]
  readonly connected: boolean
  /** Counts changes per run, so a page can refetch the run it shows. */
  readonly version: (id: string) => number
  readonly refresh: () => void
} {
  const backend = useBackend()
  const [catalog, setCatalog] = useState<Catalog>()
  const [runs, setRuns] = useState<readonly RunSummary[]>([])
  const [versions, setVersions] = useState<Readonly<Record<string, number>>>({})
  const [connected, setConnected] = useState(false)
  const refresh = useCallback(() => {
    void backend.catalog().then(setCatalog)
    void backend.runs().then(setRuns)
  }, [backend])
  useEffect(refresh, [refresh])
  const onNotice = useRef<(notice: Notice) => void>(() => {})
  onNotice.current = (notice) => {
    if (notice.catalog) void backend.catalog().then(setCatalog)
    void backend.runs().then(setRuns)
    const { run } = notice
    if (run !== undefined) setVersions((old) => ({ ...old, [run]: (old[run] ?? 0) + 1 }))
  }
  useEffect(() => backend.subscribe((notice) => onNotice.current(notice), setConnected), [backend])
  // The connection was down, so anything may have changed while it was.
  useEffect(() => {
    if (connected) refresh()
  }, [connected, refresh])
  return { catalog, runs, connected, version: (id) => versions[id] ?? 0, refresh }
}

/** The last detail fetched for each run, so a run that was open before opens at once. */
const details = new WeakMap<Backend, Map<string, RunDetail>>()

function keep(backend: Backend, id: string, detail: RunDetail | undefined): void {
  const known = details.get(backend) ?? new Map<string, RunDetail>()
  details.set(backend, known)
  if (detail === undefined) known.delete(id)
  else known.set(id, detail)
}

/** Fetches a run before its page opens, so the page does not open on a loading line. */
export async function primeRun(backend: Backend, id: string): Promise<void> {
  keep(backend, id, await backend.run(id))
}

/** The detail of one run, refetched whenever `version` changes. `null` when the run is gone. */
export function useRun(id: string, version: number): RunDetail | null | undefined {
  const backend = useBackend()
  const [detail, setDetail] = useState<RunDetail | null | undefined>(() =>
    details.get(backend)?.get(id),
  )
  useEffect(() => {
    let live = true
    void version
    void backend.run(id).then((value) => {
      keep(backend, id, value)
      if (live) setDetail(value ?? null)
    })
    return () => {
      live = false
    }
  }, [backend, id, version])
  return detail
}
