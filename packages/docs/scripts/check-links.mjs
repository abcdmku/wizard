#!/usr/bin/env node
/**
 * Every internal link in `pages/**` must point at a page that exists (`/guide/forms`, with an
 * optional `#hash` / `?query`), at a route the app serves (`/`, `/playground`) or at a generated
 * directory (`/typedoc/`, `/pagefind/`). Hardcoded `_splat` slugs in `src/**` are checked too,
 * and every redirect in `lib/redirects.mjs` must lead from a retired route to a page.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocsManifest } from '../lib/docs-manifest.mjs'
import { redirects } from '../lib/redirects.mjs'

const docsRoot = fileURLToPath(new URL('..', import.meta.url))
const pagesRoot = resolve(docsRoot, 'pages')
const ROUTES = new Set([
  '/',
  '/playground',
  ...buildDocsManifest(docsRoot).pages.map((page) => page.path),
])
const GENERATED_PREFIXES = ['/typedoc', '/pagefind']

function listFiles(dir, extensions, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, extensions, out)
    else if (extensions.has(extname(entry.name))) out.push(full)
  }
  return out
}

const lineOf = (text, index) => text.slice(0, index).split(/\r?\n/).length
const routeOf = (target) => {
  const path = target.split('#')[0].split('?')[0].replace(/\/+$/, '')
  return path === '' ? '/' : path
}
const known = (route) =>
  ROUTES.has(route) ||
  GENERATED_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))

const errors = []
const markdownLink = /\[[^\]]*\]\(([^)\s]+)(?:\s[^)]*)?\)/g
const hrefAttr = /href\s*=\s*["']([^"']+)["']/g

for (const file of listFiles(pagesRoot, new Set(['.mdx', '.md']))) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(docsRoot, file).replace(/\\/g, '/')
  for (const re of [markdownLink, hrefAttr]) {
    for (const match of text.matchAll(re)) {
      const target = match[1]
      if (!target.startsWith('/') || target.startsWith('//')) continue
      if (!known(routeOf(target)))
        errors.push(`${rel}:${lineOf(text, match.index ?? 0)} broken link "${target}"`)
    }
  }
}

const slugPattern = /_splat:\s*['"]([^'"]+)['"]/g
for (const file of listFiles(resolve(docsRoot, 'src'), new Set(['.ts', '.tsx']))) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(docsRoot, file).replace(/\\/g, '/')
  for (const match of text.matchAll(slugPattern)) {
    if (!ROUTES.has(`/${match[1]}`))
      errors.push(`${rel}:${lineOf(text, match.index ?? 0)} unknown _splat slug "${match[1]}"`)
  }
}

// A redirect leads from a route that no longer exists to a page that does.
for (const [from, to] of Object.entries(redirects)) {
  if (ROUTES.has(from)) errors.push(`lib/redirects.mjs "${from}" is a live page`)
  if (!ROUTES.has(routeOf(to))) errors.push(`lib/redirects.mjs "${from}" leads to "${to}"`)
}

if (errors.length > 0) {
  console.error('[check-links] broken links:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(
  `[check-links] ${ROUTES.size} routes and ${Object.keys(redirects).length} redirects, all internal links resolve`,
)
