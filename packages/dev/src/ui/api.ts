import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action, ActionResult, Catalog, RunDetail, RunSummary, StartRequest } from '../wire'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  return (await response.json()) as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** The calls the UI makes to the dev server. */
export const api = {
  catalog: () => request<Catalog>('/api/catalog'),
  reload: () => post<Catalog>('/api/reload', {}),
  runs: () => request<RunSummary[]>('/api/runs'),
  run: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  start: (body: StartRequest) => post<ActionResult & { id?: string }>('/api/runs', body),
  act: (id: string, action: Action) =>
    post<ActionResult>(`/api/runs/${encodeURIComponent(id)}/actions`, action),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

type Notice = { readonly run?: string; readonly catalog?: true }

/** Calls `onNotice` for every change the server reports, and says whether the stream is open. */
export function useStream(onNotice: (notice: Notice) => void): boolean {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onNotice)
  handler.current = onNotice
  useEffect(() => {
    const source = new EventSource('/api/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => handler.current(JSON.parse(message.data as string) as Notice)
    return () => source.close()
  }, [])
  return connected
}

/** The catalog and the run list, refreshed when the server reports a change. */
export function useServer(): {
  readonly catalog: Catalog | undefined
  readonly runs: readonly RunSummary[]
  readonly connected: boolean
  /** Counts changes per run, so a page can refetch the run it shows. */
  readonly version: (id: string) => number
  readonly refresh: () => void
} {
  const [catalog, setCatalog] = useState<Catalog>()
  const [runs, setRuns] = useState<readonly RunSummary[]>([])
  const [versions, setVersions] = useState<Readonly<Record<string, number>>>({})
  const refresh = useCallback(() => {
    void api.catalog().then(setCatalog)
    void api.runs().then(setRuns)
  }, [])
  useEffect(refresh, [refresh])
  const connected = useStream((notice) => {
    if (notice.catalog) void api.catalog().then(setCatalog)
    void api.runs().then(setRuns)
    const { run } = notice
    if (run !== undefined) setVersions((old) => ({ ...old, [run]: (old[run] ?? 0) + 1 }))
  })
  // The stream was down, so anything may have changed while it was.
  useEffect(() => {
    if (connected) refresh()
  }, [connected, refresh])
  return { catalog, runs, connected, version: (id) => versions[id] ?? 0, refresh }
}

/** The detail of one run, refetched whenever `version` changes. */
export function useRun(id: string, version: number): RunDetail | null | undefined {
  const [detail, setDetail] = useState<RunDetail | null>()
  useEffect(() => {
    let live = true
    void version
    void api.run(id).then((value) => {
      if (live) setDetail('id' in value ? value : null)
    })
    return () => {
      live = false
    }
  }, [id, version])
  return detail
}
