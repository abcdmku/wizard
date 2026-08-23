/**
 * Remark plugins of the docs site (run at build time inside the MDX compiler):
 *
 * - `remarkCodeFrom` — a fenced block whose meta carries `file="<repo-relative path>"` gets its
 *   body from that file (optionally `lines="3-10,14"`), so the examples pages embed the REAL,
 *   tested sources and can never drift. Missing files fail the build.
 * - `remarkRepoLinks` — markdown imported from the repository (package READMEs, design docs,
 *   example READMEs) keeps its relative links working: a link to another repo file becomes the
 *   matching site page when there is one, and a GitHub URL otherwise.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { visit } from 'unist-util-visit'

const toPosix = (value) => value.replace(/\\/g, '/')

const LANG_BY_EXT = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.json': 'json',
  '.css': 'css',
  '.md': 'md',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sh': 'sh',
}

function selectLines(content, spec) {
  const lines = content.split('\n')
  const picked = []
  for (const part of spec.split(',')) {
    const [a, b] = part
      .trim()
      .split('-')
      .map((n) => Number.parseInt(n, 10))
    const start = Number.isNaN(a) ? 1 : a
    const end = b === undefined || Number.isNaN(b) ? start : b
    for (let i = start; i <= end && i <= lines.length; i += 1) picked.push(lines[i - 1])
  }
  return picked.join('\n')
}

/** @param {{ repoRoot: string }} options */
export function remarkCodeFrom({ repoRoot }) {
  return (tree, file) => {
    visit(tree, 'code', (node) => {
      const fileMatch = node.meta?.match(/(?:^|\s)file="([^"]+)"/)
      if (!fileMatch) return
      const source = resolve(repoRoot, fileMatch[1])
      if (!existsSync(source)) {
        throw new Error(`${file.path}: code fence file="${fileMatch[1]}" does not exist`)
      }
      let content = readFileSync(source, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '')
      const linesMatch = node.meta.match(/(?:^|\s)lines="([^"]+)"/)
      if (linesMatch) content = selectLines(content, linesMatch[1])
      node.value = content
      node.lang ??= LANG_BY_EXT[extname(source)] ?? 'text'
      if (!/(?:^|\s)title=/.test(node.meta)) node.meta += ` title="${basename(source)}"`
    })
  }
}

/** Repo paths that have a page on the site (everything else links to GitHub). */
function siteRouteFor(repoPath) {
  const path = repoPath.replace(/\/$/, '')
  if (path === 'README.md') return '/getting-started'
  if (path === 'examples') return '/examples'
  const packageReadme = path.match(/^packages\/([a-z0-9-]+)\/README\.md$/)
  if (packageReadme && packageReadme[1] !== 'docs') return `/packages/${packageReadme[1]}`
  if (/^examples\/\d\d-[a-z0-9-]+(?:\/README\.md)?$/.test(path)) return '/examples'
  return null
}

/** @param {{ repoRoot: string, pagesRoot: string, githubUrl: string }} options */
export function remarkRepoLinks({ repoRoot, pagesRoot, githubUrl }) {
  return (tree, file) => {
    if (!file.path || toPosix(file.path).startsWith(toPosix(pagesRoot))) return
    const rewrite = (node) => {
      const url = node.url
      if (!url || /^(?:[a-z]+:|\/\/|\/|#)/i.test(url)) return
      const [target, hash] = url.split('#')
      const repoPath = toPosix(relative(repoRoot, resolve(dirname(file.path), target)))
      if (repoPath.startsWith('..')) return
      const route = hash?.startsWith('L') ? null : siteRouteFor(repoPath)
      node.url = route
        ? `${route}${hash ? `#${hash}` : ''}`
        : `${githubUrl}/blob/main/${repoPath}${hash ? `#${hash}` : ''}`
    }
    visit(tree, 'link', rewrite)
    visit(tree, 'definition', rewrite)
  }
}
