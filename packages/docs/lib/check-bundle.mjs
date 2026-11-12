/**
 * Monaco is several megabytes and only `/playground` needs it. This check reads each prerendered
 * page, follows the scripts it loads and everything those import statically, and reports a page
 * that reaches editor code. A dynamic `import()` is not followed: it loads on demand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const EDITOR_MARKERS = ['monaco-editor', '@monaco-editor', 'monaco.editor', 'virtual:monaco-libs']

const htmlAssets = /<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.js)"/g
const htmlImports = /\bimport\(\s*["']([^"']+\.js)["']\s*\)/g
const staticImports = /(?:^|[;}\s])(?:import|export)\b[^;'"()]*?["'](\.{1,2}\/[^"']+\.js)["']/g

/**
 * @param {string} outDir the published folder, `dist/client`
 * @param {string} base the deployment base path, `/` or `/wizard/`
 * @param {readonly string[]} pagePaths routes to check, such as `/guide/forms`
 * @returns {{ page: string, chunk: string }[]} one entry per page that loads editor code
 */
export function findEditorOnPages(outDir, base, pagePaths) {
  const prefix = base.replace(/\/$/, '')
  const verdicts = new Map()

  /** The first chunk with editor code among `file` and its static imports, or null. */
  const editorChunk = (file, seen = new Set()) => {
    if (seen.has(file) || !existsSync(file)) return null
    seen.add(file)
    if (verdicts.has(file)) return verdicts.get(file)
    const code = readFileSync(file, 'utf8')
    let found = /monaco/i.test(file) || EDITOR_MARKERS.some((m) => code.includes(m)) ? file : null
    if (!found) {
      for (const match of code.matchAll(staticImports)) {
        found = editorChunk(resolve(dirname(file), match[1]), seen)
        if (found) break
      }
    }
    verdicts.set(file, found)
    return found
  }

  const problems = []
  for (const page of pagePaths) {
    const html = readFileSync(resolve(outDir, `.${page}`, 'index.html'), 'utf8')
    const urls = [...html.matchAll(htmlAssets), ...html.matchAll(htmlImports)].map((m) => m[1])
    for (const url of new Set(urls)) {
      if (/^(?:[a-z]+:)?\/\//i.test(url)) continue
      const path = url.startsWith(prefix) ? url.slice(prefix.length) : url
      const chunk = editorChunk(resolve(outDir, `.${path.startsWith('/') ? path : `/${path}`}`))
      if (chunk) {
        problems.push({ page, chunk: chunk.slice(outDir.length + 1) })
        break
      }
    }
  }
  return problems
}
