import {
  createContext,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/** What the main area shows. */
export type Route =
  | { readonly page: 'wizard'; readonly name: string }
  | { readonly page: 'run'; readonly id: string }
  | { readonly page: 'home' }

/** The current route and a way to change it. */
export interface Nav {
  readonly route: Route
  go(route: Route): void
  /** The address of a route, for a link a person can open in a new tab. */
  href(route: Route): string
}

const parse = (hash: string): Route => {
  const [, page, ...rest] = hash.replace(/^#/, '').split('/')
  const value = decodeURIComponent(rest.join('/'))
  if (page === 'wizard' && value !== '') return { page: 'wizard', name: value }
  if (page === 'run' && value !== '') return { page: 'run', id: value }
  return { page: 'home' }
}

const hashOf = (route: Route): string => {
  if (route.page === 'wizard') return `#/wizard/${encodeURIComponent(route.name)}`
  return route.page === 'run' ? `#/run/${encodeURIComponent(route.id)}` : '#/'
}

/** Keeps the route in the address bar, so a reload and the back button work. */
export function useHashNav(enabled: boolean): Nav | undefined {
  const [route, setRoute] = useState<Route>(() =>
    enabled ? parse(location.hash) : { page: 'home' },
  )
  useEffect(() => {
    if (!enabled) return
    const onChange = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [enabled])
  return useMemo(
    () =>
      enabled
        ? {
            route,
            go: (next: Route) => {
              location.hash = hashOf(next)
            },
            href: hashOf,
          }
        : undefined,
    [enabled, route],
  )
}

/** Keeps the route in memory, for a UI that shares its page with other content. */
export function useMemoryNav(): Nav {
  const [route, setRoute] = useState<Route>({ page: 'home' })
  return useMemo(() => ({ route, go: setRoute, href: () => '#' }), [route])
}

const NavContext = createContext<Nav | undefined>(undefined)
export const NavProvider = NavContext.Provider

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (nav === undefined) throw new Error('The dev UI needs a router.')
  return nav
}

/** A link to a wizard or a run. */
export function Go(props: {
  readonly to: Route
  readonly className?: string
  readonly current?: boolean
  readonly children: ReactNode
}): ReactElement {
  const nav = useNav()
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    nav.go(props.to)
  }
  return (
    <a
      className={props.className}
      href={nav.href(props.to)}
      aria-current={props.current ? 'page' : undefined}
      onClick={onClick}
    >
      {props.children}
    </a>
  )
}
