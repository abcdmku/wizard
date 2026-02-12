export function getBasePath() {
  const base = import.meta.env.BASE_URL || '/'
  if (base === '/') return ''
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export function withBase(pathname: string) {
  if (!pathname.startsWith('/')) {
    return pathname
  }

  const base = getBasePath()
  if (!base) {
    return pathname
  }

  return `${base}${pathname}`
}
