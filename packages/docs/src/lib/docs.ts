import {
  docsNavItems,
  docsPageMap,
  docsPageOrder,
  docsPages,
  docsSections,
  topLevelPageSlugs,
} from '@/generated/docs-manifest'

export function normalizeDocSlug(value: string | undefined) {
  if (!value) return ''
  return value.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/index$/, '')
}

export function getDocPageBySlug(slug: string | undefined) {
  const normalized = normalizeDocSlug(slug)
  return docsPageMap[normalized]
}

export function getDocSibling(slug: string | undefined, offset: -1 | 1) {
  const normalized = normalizeDocSlug(slug)
  const index = docsPageOrder.indexOf(normalized)
  if (index === -1) return null
  const siblingSlug = docsPageOrder[index + offset]
  if (!siblingSlug) return null
  return docsPageMap[siblingSlug] ?? null
}

export const docsNavigation = {
  pages: docsPages,
  sections: docsSections,
  topLevelPageSlugs,
  navItems: docsNavItems,
}
