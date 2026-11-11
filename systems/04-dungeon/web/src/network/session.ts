import { type JoinDungeonInput, JoinDungeonInputSchema } from '@wizard/dungeon-shared'

const tokenKey = 'lanternfall.token.v1'
const joinKey = 'lanternfall.join.v1'

export type DungeonSession = Readonly<{
  join: JoinDungeonInput
  token: string
}>

export const removeTicketFromAddress = (): void => {
  const params = new URLSearchParams(window.location.search)
  params.delete('token')
  params.delete('ticket')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query.length > 0 ? `?${query}` : ''}`,
  )
}

const readStored = (): DungeonSession | null => {
  const token = window.sessionStorage.getItem(tokenKey)
  const storedJoin = window.sessionStorage.getItem(joinKey)
  if (token === null || token.length === 0 || storedJoin === null) return null
  try {
    const value: unknown = JSON.parse(storedJoin)
    const join = JoinDungeonInputSchema.safeParse(value)
    return join.success ? { join: join.data, token } : null
  } catch {
    return null
  }
}

const first = (params: URLSearchParams, names: readonly string[]): string => {
  for (const name of names) {
    const value = params.get(name)?.trim()
    if (value !== undefined && value.length > 0) return value
  }
  return ''
}

export const readInitialSession = (): DungeonSession | null => {
  const params = new URLSearchParams(window.location.search)
  const token = first(params, ['token', 'ticket'])
  const join = JoinDungeonInputSchema.safeParse({
    partyId: first(params, ['party', 'partyId', 'lobby']),
    displayName: first(params, ['name']) || 'Delver',
  })
  if (token.length === 0 || !join.success) return readStored()
  const session = { join: join.data, token }
  saveSession(session)
  removeTicketFromAddress()
  return session
}

export const saveSession = (session: DungeonSession): void => {
  window.sessionStorage.setItem(tokenKey, session.token)
  window.sessionStorage.setItem(joinKey, JSON.stringify(session.join))
}

export const clearSession = (): void => {
  window.sessionStorage.removeItem(tokenKey)
  window.sessionStorage.removeItem(joinKey)
}

export const resolveWebsocketUrl = (
  pageUrl: string,
  token: string,
  configuredUrl?: string,
): string => {
  const base =
    configuredUrl !== undefined && configuredUrl.length > 0
      ? new URL(configuredUrl, pageUrl)
      : new URL('/ws', pageUrl)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.searchParams.set('token', token)
  return base.toString()
}

export const websocketUrl = (session: DungeonSession): string => {
  const configured = import.meta.env.VITE_WS_URL
  return resolveWebsocketUrl(
    window.location.href,
    session.token,
    typeof configured === 'string' ? configured : undefined,
  )
}
