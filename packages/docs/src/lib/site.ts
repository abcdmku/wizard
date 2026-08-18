const repository = import.meta.env.VITE_GITHUB_REPOSITORY ?? 'abcdmku/wizard'

export const site = {
  name: 'OpenWizard',
  tagline:
    'A TypeScript-first, type-safe orchestrator for sync and async workflows — on the server, in the browser, at the edge.',
  repositoryUrl: `https://github.com/${repository}`,
  editBase: `https://github.com/${repository}/blob/main/packages/docs`,
  npmUrl: 'https://www.npmjs.com/package/@openwizard/core',
  installCommand: 'npm i @openwizard/core',
} as const

/** Prefix a site-absolute path with the deployment base (`/typedoc/` → `/wizard/typedoc/` on Pages). */
export function withBase(pathname: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return pathname.startsWith('/') && !pathname.startsWith('//') ? `${base}${pathname}` : pathname
}
