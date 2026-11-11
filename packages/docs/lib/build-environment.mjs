/** Deployment path shared by Vite and generated static reference pages. */
export function resolveBasePath(env = process.env) {
  if (env.DOCS_BASE) return env.DOCS_BASE
  if (env.NODE_ENV !== 'production' || env.GITHUB_ACTIONS !== 'true') return '/'
  const [owner, repo] = env.GITHUB_REPOSITORY?.split('/') ?? []
  return owner && repo && repo !== `${owner}.github.io` ? `/${repo}/` : '/'
}

/** The published address of the site, without a trailing slash. Absolute links are built on it. */
export function resolveSiteUrl(env = process.env) {
  if (env.DOCS_SITE_URL) return env.DOCS_SITE_URL.replace(/\/+$/, '')
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? 'abcdmku/wizard').split('/')
  return repo === `${owner}.github.io` ? `https://${repo}` : `https://${owner}.github.io/${repo}`
}
