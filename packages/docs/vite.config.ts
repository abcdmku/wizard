import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import remarkGfm from 'remark-gfm'
import rehypePrettyCode from 'rehype-pretty-code'
import { remarkCodeImport } from './lib/remark-code-import.js'

function resolveBasePath() {
  const isProd = process.env.NODE_ENV === 'production'
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'
  const githubRepository = process.env.GITHUB_REPOSITORY

  if (!isProd || !isGitHubActions || !githubRepository) {
    return '/'
  }

  const [owner, repo] = githubRepository.split('/')
  if (!owner || !repo) {
    return '/'
  }

  const isUserPage = repo === `${owner}.github.io`
  return isUserPage ? '/' : `/${repo}/`
}

function loadPrerenderPages() {
  const filePath = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    'src/generated/prerender-pages.json',
  )

  if (!existsSync(filePath)) {
    return ['/']
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    const pages = JSON.parse(content)
    if (Array.isArray(pages) && pages.length > 0) {
      return pages
    }
  } catch (error) {
    console.warn('[docs/vite] Failed to parse prerender pages file:', error)
  }

  return ['/']
}

const base = resolveBasePath()
const prerenderPages = loadPrerenderPages()
const prettyCodeOptions = {
  theme: {
    light: 'github-light',
    dark: 'github-dark',
  },
  keepBackground: false,
  defaultLang: 'plaintext',
  bypassInlineCode: true,
}

export default defineConfig({
  base,
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    mdx({
      providerImportSource: '@mdx-js/react',
      remarkPlugins: [remarkGfm, remarkCodeImport],
      rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
    }),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        crawlLinks: false,
        autoStaticPathsDiscovery: true,
      },
      pages: prerenderPages.map((path) => ({
        path,
        prerender: {
          enabled: true,
        },
      })),
    }),
    react(),
  ],
})
