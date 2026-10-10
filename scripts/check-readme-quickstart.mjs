#!/usr/bin/env node
/**
 * The root README's Quickstart must be a VERBATIM copy of a tested example file.
 *
 * Any fenced block whose info string carries `title="<path>"` (e.g.
 * ```ts title="examples/01-happy-path/src/onboarding.ts") is compared byte-for-byte (modulo
 * line endings and one trailing newline) with that file. Fails with a line-level hint.
 *
 *   node scripts/check-readme-quickstart.mjs            # check README.md (and any other .md given)
 *   node scripts/check-readme-quickstart.mjs --write    # rewrite the blocks from the files
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT } from './lib/exports.mjs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0) files.push('README.md')

const titledFence = /(```[a-zA-Z]*[^\n]*?\btitle="([^"\n]+)"[^\n]*\n)([\s\S]*?)(```)/g
const normalize = (s) => s.replaceAll('\r\n', '\n').replace(/\n+$/, '')

let problems = 0
let blocks = 0
for (const file of files) {
  const mdPath = join(ROOT, file)
  const md = readFileSync(mdPath, 'utf8')
  let next = md
  for (const match of md.matchAll(titledFence)) {
    const [whole, open, title, body, close] = match
    blocks++
    const sourcePath = join(ROOT, title)
    if (!existsSync(sourcePath)) {
      problems++
      console.error(`[readme-quickstart] ${file}: title="${title}" does not exist`)
      continue
    }
    const source = normalize(readFileSync(sourcePath, 'utf8'))
    if (normalize(body) === source) continue
    if (write) {
      next = next.replace(whole, `${open}${source}\n${close}`)
      console.log(`[readme-quickstart] ${file}: rewrote block from ${title}`)
      continue
    }
    problems++
    const a = normalize(body).split('\n')
    const b = source.split('\n')
    const line = a.findIndex((l, i) => l !== b[i])
    console.error(
      `[readme-quickstart] ${file}: the \`\`\` block titled "${title}" differs from the file` +
        ` (first difference at block line ${line + 1}:\n    README: ${JSON.stringify(a[line] ?? '<end>')}\n    file:   ${JSON.stringify(b[line] ?? '<end>')})` +
        `\n  Fix: node scripts/check-readme-quickstart.mjs --write ${file}`,
    )
  }
  if (write && next !== md) writeFileSync(mdPath, next)
}

if (blocks === 0) {
  problems++
  console.error(
    `[readme-quickstart] no \`\`\`… title="…" block found in ${files.join(', ')} — the Quickstart must mirror a tested example`,
  )
}
if (problems > 0) {
  console.error(`[readme-quickstart] ${problems} problem(s)`)
  process.exit(1)
}
console.log(
  `[readme-quickstart] ${blocks} titled block(s) match their source files (${files.map((f) => relative(ROOT, join(ROOT, f))).join(', ')})`,
)
