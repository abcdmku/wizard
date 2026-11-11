const repository = import.meta.env.VITE_GITHUB_REPOSITORY ?? 'abcdmku/wizard'

export const site = {
  name: 'OpenWizard',
  tagline: 'TypeScript workflows that can wait, retry, and resume.',
  /** Used in search results. */
  description:
    'OpenWizard runs typed TypeScript workflows that can collect input, wait for events, retry failed work, and resume from saved state.',
  repositoryUrl: `https://github.com/${repository}`,
  editBase: `https://github.com/${repository}/blob/main/packages/docs`,
  npmUrl: 'https://www.npmjs.com/package/@openwizard/core',
  installCommand: 'npm install @openwizard/core zod',
} as const

/** Prefix a site-absolute path with the deployment base (`/typedoc/` → `/wizard/typedoc/` on Pages). */
export function withBase(pathname: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return pathname.startsWith('/') && !pathname.startsWith('//') ? `${base}${pathname}` : pathname
}
