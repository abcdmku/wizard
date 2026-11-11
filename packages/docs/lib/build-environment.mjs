/** Deployment path shared by Vite and generated static reference pages. */
export function resolveBasePath(env = process.env) {
  if (env.DOCS_BASE) return env.DOCS_BASE
  if (env.NODE_ENV !== 'production' || env.GITHUB_ACTIONS !== 'true') return '/'
  const [owner, repo] = env.GITHUB_REPOSITORY?.split('/') ?? []
  return owner && repo && repo !== `${owner}.github.io` ? `/${repo}/` : '/'
}
