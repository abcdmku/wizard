#!/usr/bin/env node
/**
 * After `vite build` (client + server + prerender):
 *   1. index the prerendered HTML with Pagefind → dist/client/pagefind/
 *   2. generate the TypeDoc reference from the built declarations → dist/client/typedoc/
 *   3. verify that every page of the manifest was prerendered
 * The publishable site is `dist/client`.
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pagefind from 'pagefind'
import { Application } from 'typedoc'
import { buildDocsManifest } from '../lib/docs-manifest.mjs'

const docsRoot = fileURLToPath(new URL('..', import.meta.url))
const client = resolve(docsRoot, 'dist', 'client')

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
const app = await Application.bootstrapWithPlugins({ options: resolve(docsRoot, 'typedoc.json') })
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
console.log(`[postbuild] ${expected.length} pages prerendered, site ready in dist/client`)
