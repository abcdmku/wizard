import { fileURLToPath } from 'node:url'
import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { defineConfig } from 'vite'
import { resolveBasePath } from './lib/build-environment.mjs'
import { buildDocsManifest } from './lib/docs-manifest.mjs'
import { remarkCodeFrom, remarkRepoLinks } from './lib/remark-plugins.mjs'
import { docsManifestPlugin, monacoLibsPlugin } from './lib/vite-plugins.mjs'

const docsRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const pagesRoot = fileURLToPath(new URL('./pages', import.meta.url))
const devConfigSource = fileURLToPath(new URL('../dev/src/config.ts', import.meta.url))
const githubUrl = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'abcdmku/wizard'}`

const base = resolveBasePath()
const prerenderPages = [...buildDocsManifest(docsRoot).prerenderPages, '/playground']

export default defineConfig({
  base,
  // Markdown imported from outside this package (READMEs, design docs) is compiled to modules
  // importing react / @mdx-js/react: `dedupe` resolves those from here, not from the repo root.
  resolve: {
    dedupe: ['react', 'react-dom', '@mdx-js/react'],
    // The package entry starts a Node server. A page needs only `defineDev` and `devWizard`.
    alias: [{ find: /^@openwizard\/dev$/, replacement: devConfigSource }],
  },
  optimizeDeps: { exclude: ['virtual:docs-manifest', 'virtual:monaco-libs'] },
  worker: { format: 'es' },
  plugins: [
    docsManifestPlugin(docsRoot),
    monacoLibsPlugin(docsRoot),
    {
      enforce: 'pre',
      ...mdx({
        providerImportSource: '@mdx-js/react',
        remarkPlugins: [
          remarkGfm,
          [remarkCodeFrom, { repoRoot }],
          [remarkRepoLinks, { repoRoot, pagesRoot, githubUrl }],
        ],
        rehypePlugins: [
          rehypeSlug,
          [
            rehypePrettyCode,
            {
              theme: { light: 'github-light', dark: 'github-dark' },
              keepBackground: false,
              defaultLang: 'plaintext',
              bypassInlineCode: true,
            },
          ],
        ],
      }),
    },
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
        autoSubfolderIndex: true,
        failOnError: true,
      },
      pages: prerenderPages.map((path) => ({ path, prerender: { enabled: true } })),
    }),
    react(),
  ],
})
