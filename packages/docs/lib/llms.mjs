/**
 * `llms.txt` and `llms-full.txt`, built from `pages/` so they cannot drift from the site.
 *
 * - `llms.txt` lists every page with its one-line summary, grouped as the sidebar groups them.
 * - `llms-full.txt` is every page in reading order as Markdown, with each `file="..."` code
 *   fence filled from the tested file it names and each internal link made absolute.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDocsManifest } from './docs-manifest.mjs'
import { selectLines } from './remark-plugins.mjs'

const normalize = (text) => text.replace(/\r\n/g, '\n')

/** The first paragraph under the page's `# Title`, on one line. */
function summaryOf(markdown) {
  const afterTitle = markdown.replace(/^[\s\S]*?^#\s+.+$/m, '')
  const paragraph = afterTitle.split(/\n{2,}/).find((block) => /^[A-Za-z`[]/.test(block.trim()))
  return paragraph ? paragraph.trim().replace(/\s*\n\s*/g, ' ') : ''
}

/** Fill `file="..."` fences from the repository, as the site build does. */
function expandFences(markdown, repoRoot, sourcePath) {
  const fence = /^```([^\n]*\bfile="([^"]+)"[^\n]*)\n([\s\S]*?)^```$/gm
  return markdown.replace(fence, (_, meta, file) => {
    const source = resolve(repoRoot, file)
    if (!existsSync(source)) {
      throw new Error(`${sourcePath}: code fence file="${file}" does not exist`)
    }
    let content = normalize(readFileSync(source, 'utf8')).replace(/\n+$/, '')
    const lines = meta.match(/\blines="([^"]+)"/)
    if (lines) content = selectLines(content, lines[1])
    const lang = meta.trim().split(/\s+/)[0]
    return `\`\`\`${lang.includes('=') ? '' : lang}\n${content}\n\`\`\``
  })
}

/** A diagram is a component of the site. Its code and the page text already say what it shows. */
const withoutDiagrams = (markdown) =>
  markdown.replace(/^<(?:RunDiagram|Sequence)\b[^>]*\/>\n\n?/gm, '')

/** `[text](/guide/forms)` to `[text](https://.../guide/forms)`. */
const absoluteLinks = (markdown, siteUrl) =>
  markdown.replace(/(\]\()(\/(?!\/)[^)\s]*)/g, (_, open, path) => `${open}${siteUrl}${path}`)

/**
 * @param {{ docsRoot: string, repoRoot: string, siteUrl: string, name: string, description: string }} options
 * @returns {{ index: string, full: string }} the contents of `llms.txt` and `llms-full.txt`
 */
export function buildLlmsFiles({ docsRoot, repoRoot, siteUrl, name, description }) {
  const { pages, sections, navItems } = buildDocsManifest(docsRoot)
  const bySlug = new Map(pages.map((page) => [page.slug, page]))
  const read = (page) => normalize(readFileSync(resolve(docsRoot, page.sourcePath), 'utf8'))
  const url = (page) => `${siteUrl}${page.path}`
  const entry = (page, number) => {
    const summary = summaryOf(read(page))
    const title = number === undefined ? page.title : `${number}. ${page.title}`
    return `- [${title}](${url(page)})${summary ? `: ${summary}` : ''}`
  }

  const index = [`# ${name}`, '', `> ${description}`, '']
  for (const item of navItems) {
    if (item.type === 'page') {
      const page = bySlug.get(item.slug)
      index.push(`## ${page.title}`, '', entry(page), '')
      continue
    }
    const section = sections.find((candidate) => candidate.id === item.id)
    index.push(`## ${section.title}`, '')
    section.slugs.forEach((slug, i) => {
      index.push(entry(bySlug.get(slug), section.numbered ? i + 1 : undefined))
    })
    index.push('')
  }
  index.push(
    '## Optional',
    '',
    `- [Every page as one file](${siteUrl}/llms-full.txt)`,
    `- [Generated API reference](${siteUrl}/typedoc/)`,
    '',
  )

  const full = [`# ${name}`, '', `> ${description}`, '']
  for (const page of pages) {
    const body = absoluteLinks(
      expandFences(withoutDiagrams(read(page)), repoRoot, page.sourcePath),
      siteUrl,
    )
    full.push('---', '', `Source: ${url(page)}`, '', body.trim(), '')
  }
  return { index: index.join('\n'), full: full.join('\n') }
}
