import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { isGeneratedContent, isHandwrittenSourcePath, normalizePath } from './config.mjs'

export function listFiles(root, relativeDirectory = '.') {
  const start = resolve(root, relativeDirectory)
  if (!existsSync(start)) return []

  const files = []
  visit(start, files)
  return files.map((path) => normalizePath(relative(root, path))).sort()
}

export function readHandwrittenFile(root, path) {
  const normalized = normalizePath(path)
  if (!isHandwrittenSourcePath(normalized)) return undefined

  const absolutePath = resolve(root, normalized)
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) return undefined
  const content = readFileSync(absolutePath, 'utf8')
  if (isGeneratedContent(content)) return undefined
  return { content, lines: countLines(content), path: normalized }
}

export function countLines(content) {
  if (content.length === 0) return 0
  const count = content.split(/\r\n|\n|\r/).length
  return /(?:\r\n|\n|\r)$/.test(content) ? count - 1 : count
}

function visit(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) visit(path, files)
    else if (entry.isFile()) files.push(path)
  }
}
