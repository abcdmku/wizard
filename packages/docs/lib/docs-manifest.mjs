/**
 * Build-time docs manifest: walk `pages/**\/*.mdx`, apply the `_meta.json` ordering / titles,
 * and return the navigation model the site renders (pages, sections, nav items, prerender
 * list). Shared by the Vite virtual module (`virtual:docs-manifest`), the config (prerender
 * pages) and the check scripts, so there is exactly one notion of "the pages".
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

const toPosix = (value) => value.replace(/\\/g, '/')

const humanize = (slug) =>
  slug
    .split('/')
    .filter(Boolean)
    .pop()
    ?.split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') ?? 'Untitled'

const routeSlug = (raw) => {
  if (raw === 'index') return ''
  return raw.endsWith('/index') ? raw.slice(0, -'/index'.length) : raw
}

const firstHeading = (filePath) => {
  const match = readFileSync(filePath, 'utf8').match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

function listMdxFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) listMdxFiles(full, out)
    else if (extname(entry.name) === '.mdx' && !entry.name.startsWith('_')) out.push(full)
  }
  return out
}

const readJson = (filePath) =>
  existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null

/**
 * @param {string} docsRoot absolute path of packages/docs
 * @returns {{ pages: object[], sections: object[], navItems: object[], prerenderPages: string[] }}
 */
export function buildDocsManifest(docsRoot) {
  const pagesRoot = resolve(docsRoot, 'pages')
  const pagesBySlug = new Map()
  for (const filePath of listMdxFiles(pagesRoot)) {
    const rel = toPosix(relative(pagesRoot, filePath)).replace(/\.mdx$/, '')
    const slug = routeSlug(rel)
    const sourcePath = toPosix(relative(docsRoot, filePath))
    pagesBySlug.set(slug, {
      slug,
      path: slug ? `/${slug}` : '/',
      title: firstHeading(filePath) ?? humanize(slug),
      sourcePath,
      modulePath: `../../${sourcePath}`,
      section: null,
    })
  }

  const rootMeta = readJson(resolve(pagesRoot, '_meta.json')) ?? {}
  const ordered = []
  const seen = new Set()
  const sections = []
  const navItems = []

  const place = (slug, section, title) => {
    const page = pagesBySlug.get(slug)
    if (!page || seen.has(slug)) return
    seen.add(slug)
    ordered.push(slug)
    page.section = section
    if (typeof title === 'string') page.title = title
  }

  for (const [key, value] of Object.entries(rootMeta)) {
    if (typeof value === 'string') {
      // A single top-level page: "getting-started": "Getting started"
      const slug = routeSlug(key)
      place(slug, null, value)
      navItems.push({ type: 'page', slug })
      continue
    }
    if (value && typeof value === 'object') {
      // A section folder: "concepts": { "title": "Concepts" } — ordered by pages/concepts/_meta.json
      const sectionId = key
      const sectionMeta = readJson(resolve(pagesRoot, sectionId, '_meta.json')) ?? {}
      const slugs = []
      for (const [child, childTitle] of Object.entries(sectionMeta)) {
        const slug = child === 'index' ? sectionId : `${sectionId}/${child}`
        if (!pagesBySlug.has(slug)) continue
        place(slug, sectionId, childTitle)
        slugs.push(slug)
      }
      // Pages of the folder that _meta.json forgot, alphabetically after the listed ones.
      for (const slug of [...pagesBySlug.keys()].sort()) {
        if (slug.startsWith(`${sectionId}/`) && !seen.has(slug)) {
          place(slug, sectionId, undefined)
          slugs.push(slug)
        }
      }
      sections.push({
        id: sectionId,
        title: typeof value.title === 'string' ? value.title : humanize(sectionId),
        slugs,
      })
      navItems.push({ type: 'section', id: sectionId })
    }
  }
  for (const slug of [...pagesBySlug.keys()].sort()) place(slug, null, undefined)

  const pages = ordered.map((slug, order) => ({ ...pagesBySlug.get(slug), order }))
  const prerenderPages = [...new Set(['/', ...pages.map((page) => page.path)])]
  return { pages, sections, navItems, prerenderPages }
}
