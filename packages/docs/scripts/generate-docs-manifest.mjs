#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const docsRoot = resolve(__dirname, '..')
const pagesRoot = resolve(docsRoot, 'pages')
const generatedRoot = resolve(docsRoot, 'src', 'generated')
const manifestPath = resolve(generatedRoot, 'docs-manifest.ts')
const prerenderPath = resolve(generatedRoot, 'prerender-pages.json')
const rootMetaPath = resolve(pagesRoot, '_meta.json')

function toPosix(value) {
  return value.replace(/\\/g, '/')
}

function humanizeSlug(value) {
  return value
    .split('/')
    .filter(Boolean)
    .pop()
    ?.split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Untitled'
}

function normalizeRouteSlug(rawSlug) {
  if (rawSlug === 'index') return ''
  if (rawSlug.endsWith('/index')) {
    return rawSlug.slice(0, -'/index'.length)
  }
  return rawSlug
}

function normalizeMetaSlug(rawSlug) {
  return rawSlug.replace(/^\/+/, '').replace(/\/+$/, '')
}

function extractTitleFromMdx(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/)
    if (match) {
      return match[1].trim()
    }
  }
  return null
}

function listMdxFiles(dirPath) {
  const files = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = resolve(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...listMdxFiles(entryPath))
      continue
    }
    if (extname(entry.name) === '.mdx' && !entry.name.startsWith('_')) {
      files.push(entryPath)
    }
  }
  return files
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

const files = listMdxFiles(pagesRoot)
const pagesBySlug = new Map()

for (const filePath of files) {
  const relativeToPages = toPosix(relative(pagesRoot, filePath)).replace(/\.mdx$/, '')
  const slug = normalizeRouteSlug(relativeToPages)
  const sourcePath = toPosix(relative(docsRoot, filePath))
  const title = extractTitleFromMdx(filePath) ?? humanizeSlug(slug)
  pagesBySlug.set(slug, {
    slug,
    path: slug ? `/${slug}` : '/',
    title,
    sourcePath,
    modulePath: `../../${sourcePath}`,
    editPath: sourcePath,
    section: null,
  })
}

if (!pagesBySlug.has('')) {
  throw new Error('Missing pages/index.mdx. The docs landing page is required.')
}

const rootMeta = readJson(rootMetaPath)
const topLevelSlugs = []
const sectionDrafts = []
const navItems = []
const orderedSlugs = []
const seenSlugs = new Set()

function addOrderedSlug(slug, section) {
  if (!pagesBySlug.has(slug)) return
  if (seenSlugs.has(slug)) return
  seenSlugs.add(slug)
  orderedSlugs.push(slug)
  if (section) {
    const page = pagesBySlug.get(slug)
    page.section = section
  }
}

function resolveTopLevelSlug(key) {
  if (pagesBySlug.has(key)) return key
  const normalized = normalizeRouteSlug(key)
  if (pagesBySlug.has(normalized)) return normalized
  return null
}

function resolveChildTitle(childSlug, fallbackTitle) {
  const [sectionKey, leafKey] = childSlug.split('/')
  if (!sectionKey || !leafKey) return fallbackTitle

  const sectionMetaPath = resolve(pagesRoot, sectionKey, '_meta.json')
  try {
    const sectionMeta = readJson(sectionMetaPath)
    const title = sectionMeta[leafKey]
    if (typeof title === 'string') {
      return title
    }
  } catch (error) {
    // Ignore missing child meta and use fallback.
  }

  return fallbackTitle
}

function resolveSectionMeta(sectionId) {
  const sectionMetaPath = resolve(pagesRoot, sectionId, '_meta.json')
  try {
    return readJson(sectionMetaPath)
  } catch (error) {
    return null
  }
}

for (const [key, value] of Object.entries(rootMeta)) {
  if (key === 'index') {
    continue
  }

  if (typeof value === 'string') {
    const slug = resolveTopLevelSlug(key)
    if (!slug) {
      continue
    }
    topLevelSlugs.push(slug)
    navItems.push({
      type: 'page',
      slug,
    })
    const page = pagesBySlug.get(slug)
    page.title = value
    addOrderedSlug(slug, null)

    const sectionMeta = resolveSectionMeta(slug)
    if (sectionMeta && typeof sectionMeta === 'object') {
      for (const [childKey, childValue] of Object.entries(sectionMeta)) {
        if (childKey === 'index') continue
        if (typeof childValue !== 'string') continue

        const childSlug = `${slug}/${childKey}`
        if (!pagesBySlug.has(childSlug)) continue
        const childPage = pagesBySlug.get(childSlug)
        childPage.title = childValue
        addOrderedSlug(childSlug, slug)
      }
    }

    const childPrefix = `${slug}/`
    const childSlugs = [...pagesBySlug.keys()].filter(
      (candidateSlug) => candidateSlug.startsWith(childPrefix) && !seenSlugs.has(candidateSlug),
    )

    for (const childSlug of childSlugs.sort((a, b) => a.localeCompare(b))) {
      addOrderedSlug(childSlug, slug)
    }

    continue
  }

  if (value && typeof value === 'object' && Array.isArray(value.children)) {
    const sectionId = key
    const sectionTitle = typeof value.title === 'string' ? value.title : humanizeSlug(key)
    const collapsed = Boolean(value.theme && value.theme.collapsed)
    const sectionSlugs = []

    for (const child of value.children) {
      if (typeof child !== 'string') continue
      const slug = normalizeMetaSlug(child)
      if (!pagesBySlug.has(slug)) continue

      const page = pagesBySlug.get(slug)
      page.title = resolveChildTitle(slug, page.title)
      sectionSlugs.push(slug)
      addOrderedSlug(slug, sectionId)
    }

    sectionDrafts.push({
      id: sectionId,
      title: sectionTitle,
      collapsed,
      slugs: sectionSlugs,
    })
    navItems.push({
      type: 'section',
      id: sectionId,
    })
  }
}

for (const slug of [...pagesBySlug.keys()].sort((a, b) => a.localeCompare(b))) {
  if (slug === '') continue
  addOrderedSlug(slug, null)
}

const orderedPages = orderedSlugs.map((slug, index) => {
  const page = pagesBySlug.get(slug)
  return {
    ...page,
    order: index,
  }
})

const docsPrerenderPages = ['/', ...orderedPages.map((page) => page.path)]
const uniquePrerenderPages = [...new Set(docsPrerenderPages)]

mkdirSync(generatedRoot, { recursive: true })

const manifestSource = `/* AUTO-GENERATED by scripts/generate-docs-manifest.mjs. Do not edit manually. */
export interface DocsPage {
  slug: string;
  path: string;
  title: string;
  sourcePath: string;
  modulePath: string;
  editPath: string;
  section: string | null;
  order: number;
}

export interface DocsSection {
  id: string;
  title: string;
  collapsed: boolean;
  slugs: string[];
}

export type DocsNavItem =
  | {
      type: 'page';
      slug: string;
    }
  | {
      type: 'section';
      id: string;
    };

export const docsPages: DocsPage[] = ${JSON.stringify(orderedPages, null, 2)};

export const docsPageMap: Record<string, DocsPage> = Object.fromEntries(
  docsPages.map((page) => [page.slug, page]),
);

export const docsPageOrder = docsPages.map((page) => page.slug);

export const topLevelPageSlugs: string[] = ${JSON.stringify(topLevelSlugs, null, 2)};

export const docsSections: DocsSection[] = ${JSON.stringify(sectionDrafts, null, 2)};

export const docsNavItems: DocsNavItem[] = ${JSON.stringify(navItems, null, 2)};

export const docsPrerenderPages: string[] = ${JSON.stringify(uniquePrerenderPages, null, 2)};
`

writeFileSync(manifestPath, manifestSource)
writeFileSync(prerenderPath, `${JSON.stringify(uniquePrerenderPages, null, 2)}\n`)

console.log(
  `[generate-docs-manifest] Wrote ${toPosix(relative(docsRoot, manifestPath))} (${orderedPages.length} pages)`,
)
