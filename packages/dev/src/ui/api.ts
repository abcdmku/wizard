import type { Action, ActionResult, Catalog, RunDetail, RunSummary, StartRequest } from '../wire'
import type { Backend, Notice } from './backend'

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

/** The backend of `openwizard dev`: every call is a request to the dev server. */
export function httpBackend(): Backend {
  return {
    place: 'server',
    catalog: () => request<Catalog>('/api/catalog'),
    reload: () => post<Catalog>('/api/reload', {}),
    runs: () => request<RunSummary[]>('/api/runs'),
    run: async (id) => {
      const value = await request<RunDetail | { message: string }>(
        `/api/runs/${encodeURIComponent(id)}`,
      )
      return 'id' in value ? value : undefined
    },
    start: (body: StartRequest) => post<ActionResult & { id?: string }>('/api/runs', body),
    act: (id: string, action: Action) =>
      post<ActionResult>(`/api/runs/${encodeURIComponent(id)}/actions`, action),
    remove: async (id) =>
      (await request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }))
        .ok,
    subscribe(onNotice, onOpen) {
      const source = new EventSource('/api/stream')
      source.onopen = () => onOpen(true)
      source.onerror = () => onOpen(false)
      source.onmessage = (message) => onNotice(JSON.parse(message.data as string) as Notice)
      return () => source.close()
    },
  }
}
