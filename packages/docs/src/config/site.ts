const defaultRepo = 'https://github.com/abcdmku/wizard'

function getRepositoryUrl() {
  const explicit = import.meta.env.VITE_GITHUB_REPO_URL
  if (explicit) return explicit

  const repository = import.meta.env.VITE_GITHUB_REPOSITORY
  if (repository) {
    return `https://github.com/${repository}`
  }

  return defaultRepo
}

const repositoryUrl = getRepositoryUrl()

export const siteConfig = {
  title: 'Wizard',
  description:
    'A deeply type-safe, isomorphic, headless multi-step wizard library for TypeScript applications.',
  repositoryUrl,
  docsRepositoryBase: `${repositoryUrl}/tree/main/packages/docs`,
  discordUrl: 'https://discord.gg/wizardopus',
  footerText: `${new Date().getUTCFullYear()} (c) Wizard`,
}
