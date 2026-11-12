#!/usr/bin/env node
/**
 * After `vite build` (client + server + prerender):
 *   1. index the prerendered HTML with Pagefind → dist/client/pagefind/
 *   2. generate the TypeDoc reference from the built declarations → dist/client/typedoc/
 *   3. verify that every page of the manifest was prerendered
 *   4. write a redirect page at every old route → dist/client/<old route>/index.html
 *   5. write llms.txt and llms-full.txt from the pages
 *   6. verify that no docs page loads the playground's editor
 * The publishable site is `dist/client`.
 */
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pagefind from 'pagefind'
import { Application } from 'typedoc'
import { resolveBasePath, resolveSiteUrl } from '../lib/build-environment.mjs'
import { findEditorOnPages } from '../lib/check-bundle.mjs'
import { buildDocsManifest } from '../lib/docs-manifest.mjs'
import { buildLlmsFiles } from '../lib/llms.mjs'
import { redirects, writeRedirectPages } from '../lib/redirects.mjs'

const docsRoot = fileURLToPath(new URL('..', import.meta.url))
const client = resolve(docsRoot, 'dist', 'client')
const base = resolveBasePath()

if (!existsSync(resolve(client, 'index.html'))) {
  console.error('[postbuild] dist/client/index.html is missing — run `vite build` first')
  process.exit(1)
}

// 1. Search index over the docs pages (before TypeDoc is copied in, so it is not indexed).
// Only elements marked `data-pagefind-body` (the docs article) are indexed.
const { index, errors } = await pagefind.createIndex()
if (!index) {
  console.error('[postbuild] pagefind failed to start:', errors)
  process.exit(1)
}
const added = await index.addDirectory({ path: client })
await index.writeFiles({ outputPath: resolve(client, 'pagefind') })
await pagefind.close()
console.log(`[postbuild] pagefind indexed ${added.page_count} pages`)

// 2. TypeDoc from the built d.ts (options in typedoc.json).
const typedocOut = resolve(docsRoot, 'dist', 'typedoc')
rmSync(typedocOut, { recursive: true, force: true })
const app = await Application.bootstrapWithPlugins({
  options: resolve(docsRoot, 'typedoc.json'),
  titleLink: base,
  navigationLinks: {
    Docs: base,
    GitHub: `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'abcdmku/wizard'}`,
  },
})
const project = await app.convert()
if (!project) {
  console.error('[postbuild] typedoc could not convert the entry points')
  process.exit(1)
}
await app.generateDocs(project, typedocOut)
if (!existsSync(resolve(typedocOut, 'index.html'))) {
  console.error('[postbuild] typedoc produced no output')
  process.exit(1)
}
cpSync(typedocOut, resolve(client, 'typedoc'), { recursive: true })
console.log('[postbuild] typedoc copied to dist/client/typedoc')

// 3. Every manifest page (and the playground) must have been prerendered.
const expected = [...buildDocsManifest(docsRoot).prerenderPages, '/playground']
const missing = expected.filter((path) => !existsSync(resolve(client, `.${path}`, 'index.html')))
if (missing.length > 0) {
  console.error(`[postbuild] ${missing.length} page(s) were not prerendered: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`[postbuild] ${expected.length} pages prerendered`)

// 4. Old routes. A redirect must never replace a page that exists.
const shadowed = Object.keys(redirects).filter((from) => expected.includes(from))
if (shadowed.length > 0) {
  console.error(`[postbuild] redirects would replace live pages: ${shadowed.join(', ')}`)
  process.exit(1)
}
console.log(`[postbuild] ${writeRedirectPages(client, base)} redirect pages written`)

// 5. The same pages as plain text for language models.
const llms = buildLlmsFiles({
  docsRoot,
  repoRoot: resolve(docsRoot, '..', '..'),
  siteUrl: resolveSiteUrl(),
  name: 'OpenWizard',
  description:
    'OpenWizard runs typed TypeScript workflows that can collect input, wait for events, retry failed work, and resume from saved state.',
})
writeFileSync(resolve(client, 'llms.txt'), llms.index)
writeFileSync(resolve(client, 'llms-full.txt'), llms.full)
console.log('[postbuild] llms.txt and llms-full.txt written')

// 6. Monaco belongs to /playground. Every other page must load without it.
const docsPaths = expected.filter((path) => path !== '/playground')
const withEditor = findEditorOnPages(client, base, docsPaths)
if (withEditor.length > 0) {
  console.error('[postbuild] these pages load the Monaco editor:')
  for (const { page, chunk } of withEditor) console.error(`- ${page} through ${chunk}`)
  process.exit(1)
}
console.log(`[postbuild] ${docsPaths.length} pages load no editor code, site ready in dist/client`)

if (process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY) {
  const revision = {
    commit: process.env.GITHUB_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF ?? '',
  }
  writeFileSync(resolve(client, 'build-info.json'), `${JSON.stringify(revision, null, 2)}\n`)
  console.log('[postbuild] build-info.json records the deployed revision')
}
