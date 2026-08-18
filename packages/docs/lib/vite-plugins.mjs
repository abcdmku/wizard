/**
 * Docs-site Vite plugins (build-time only, plain ESM so `vite.config.ts` and the scripts can
 * share them):
 *
 * - `docsManifestPlugin` — `virtual:docs-manifest`: the navigation model built from `pages/`.
 * - `monacoLibsPlugin`  — `virtual:monaco-libs`: the `.d.ts` files the in-browser editor needs
 *   for real type checking — the BUILT `@openwizard/core` declarations and the real `zod` types
 *   (crawled from `node_modules/zod`), keyed by the `file:///node_modules/…` URI Monaco resolves.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { buildDocsManifest } from './docs-manifest.mjs'

const toPosix = (value) => value.replace(/\\/g, '/')

/** @param {string} docsRoot */
export function docsManifestPlugin(docsRoot) {
  const id = 'virtual:docs-manifest'
  const resolvedId = `\0${id}`
  return {
    name: 'openwizard-docs-manifest',
    resolveId(source) {
      return source === id ? resolvedId : null
    },
    load(moduleId) {
      if (moduleId !== resolvedId) return null
      const manifest = buildDocsManifest(docsRoot)
      return [
        `export const docsPages = ${JSON.stringify(manifest.pages)};`,
        `export const docsSections = ${JSON.stringify(manifest.sections)};`,
        `export const docsNavItems = ${JSON.stringify(manifest.navItems)};`,
      ].join('\n')
    },
    configureServer(server) {
      // Editing a page or a _meta.json changes the manifest → invalidate the virtual module.
      const pagesRoot = resolve(docsRoot, 'pages')
      server.watcher.add(pagesRoot)
      const invalidate = (file) => {
        if (!toPosix(file).startsWith(toPosix(pagesRoot))) return
        const mod = server.moduleGraph.getModuleById(resolvedId)
        if (mod) server.moduleGraph.invalidateModule(mod)
      }
      server.watcher.on('add', invalidate)
      server.watcher.on('unlink', invalidate)
      server.watcher.on('change', invalidate)
    },
  }
}

const importRe = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g

/** Follow the relative imports of a `.d.ts` file (`./x.js` → `x.d.ts`, `../core/index.js`, …). */
function crawlDts(entryFile, pkgRoot, pkgName, out) {
  const stack = [entryFile]
  while (stack.length > 0) {
    const file = stack.pop()
    if (out.has(file) || !existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    out.set(file, text)
    for (const match of text.matchAll(importRe)) {
      const spec = match[1] ?? match[2]
      if (!spec?.startsWith('.')) continue
      const base = resolve(dirname(file), spec).replace(/\.(m|c)?js$/, '')
      for (const candidate of [`${base}.d.ts`, join(base, 'index.d.ts')]) {
        if (existsSync(candidate)) {
          stack.push(candidate)
          break
        }
      }
    }
  }
  return [...out].map(([file, text]) => [
    `file:///node_modules/${pkgName}/${toPosix(relative(pkgRoot, file))}`,
    text,
  ])
}

/** @param {string} docsRoot */
export function monacoLibsPlugin(docsRoot) {
  const id = 'virtual:monaco-libs'
  const resolvedId = `\0${id}`
  return {
    name: 'openwizard-monaco-libs',
    resolveId(source) {
      return source === id ? resolvedId : null
    },
    load(moduleId) {
      if (moduleId !== resolvedId) return null
      const require = createRequire(join(docsRoot, 'package.json'))
      const coreDist = dirname(require.resolve('@openwizard/core/package.json'))
      const zodRoot = dirname(require.resolve('zod/package.json'))
      const libs = [
        [
          'file:///node_modules/@openwizard/core/index.d.ts',
          readFileSync(join(coreDist, 'dist', 'index.d.ts'), 'utf8'),
        ],
        [
          'file:///node_modules/@openwizard/core/testing.d.ts',
          readFileSync(join(coreDist, 'dist', 'testing.d.ts'), 'utf8'),
        ],
        ...crawlDts(join(zodRoot, 'index.d.ts'), zodRoot, 'zod', new Map()),
      ]
      return `export const monacoLibs = ${JSON.stringify(Object.fromEntries(libs))};`
    },
  }
}
