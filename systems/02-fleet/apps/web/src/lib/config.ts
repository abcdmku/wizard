const runtimeUrl = window.__FLEET_CONFIG__?.apiUrl?.trim()
const buildUrl = import.meta.env.VITE_FLEET_API_URL?.trim()

export const apiBaseUrl = (runtimeUrl || buildUrl || '/api').replace(/\/$/, '')

export function endpoint(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${apiBaseUrl}${normalized}`
}
