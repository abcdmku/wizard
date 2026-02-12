import type { ComponentType } from 'react'
import { docsPageMap } from '@/generated/docs-manifest'
import { normalizeDocSlug } from '@/lib/docs'

type MdxModule = {
  default: ComponentType
}

type MdxImporter = () => Promise<MdxModule>

const mdxModules = import.meta.glob('../../pages/**/*.mdx') as Record<string, MdxImporter>
const modulePromiseCache = new Map<string, Promise<MdxModule>>()
const resolvedModuleCache = new Map<string, MdxModule>()

export function hasDocModule(modulePath: string) {
  return Boolean(mdxModules[modulePath])
}

export function loadDocModule(modulePath: string): Promise<MdxModule> {
  const resolvedModule = resolvedModuleCache.get(modulePath)
  if (resolvedModule) {
    return Promise.resolve(resolvedModule)
  }

  const cachedPromise = modulePromiseCache.get(modulePath)
  if (cachedPromise) {
    return cachedPromise
  }

  const importer = mdxModules[modulePath]
  if (!importer) {
    return Promise.reject(new Error(`Unknown docs module path: ${modulePath}`))
  }

  const pendingModule = importer()
    .then((module) => {
      resolvedModuleCache.set(modulePath, module)
      return module
    })
    .catch((error) => {
      modulePromiseCache.delete(modulePath)
      resolvedModuleCache.delete(modulePath)
      throw error
    })

  modulePromiseCache.set(modulePath, pendingModule)
  return pendingModule
}

export function getLoadedDocModule(modulePath: string) {
  return resolvedModuleCache.get(modulePath)
}

export function prefetchDocModule(modulePath: string) {
  void loadDocModule(modulePath).catch(() => {
    // Ignore prefetch failures and let route rendering surface real errors.
  })
}

export function prefetchDocModuleBySlug(slug: string | undefined) {
  const normalizedSlug = normalizeDocSlug(slug)
  if (!normalizedSlug) return

  const page = docsPageMap[normalizedSlug]
  if (!page) return

  prefetchDocModule(page.modulePath)
}
