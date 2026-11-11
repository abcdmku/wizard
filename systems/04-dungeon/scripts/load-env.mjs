#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/u

const unquote = (raw) => {
  if (raw.length < 2) return raw
  const quote = raw[0]
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) return raw
  const value = raw.slice(1, -1)
  return quote === '"'
    ? value.replaceAll('\\n', '\n').replaceAll('\\"', '"').replaceAll('\\\\', '\\')
    : value
}

const withoutInlineComment = (raw) => {
  let quote = null
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quote !== null) {
      if (character === quote && (quote !== '"' || raw[index - 1] !== '\\')) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && index > 0 && /\s/u.test(raw[index - 1])) {
      return raw.slice(0, index).trimEnd()
    }
  }
  return raw
}

export const parseDotEnv = (source) => {
  const values = new Map()
  for (const rawLine of source.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (assignment === null || !variableName.test(assignment[1])) continue
    const rawValue = assignment[2].trim()
    values.set(assignment[1], unquote(withoutInlineComment(rawValue)))
  }
  return values
}

export const envFilePath = (target = process.env) => {
  const configured = target.DUNGEON_ENV_FILE ?? '.env'
  return path.isAbsolute(configured) ? configured : path.resolve(systemRoot, configured)
}

const readDotEnv = (filePath) => {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}

export const loadDungeonEnv = (target = process.env, options = {}) => {
  const filePath = options.filePath ?? envFilePath(target)
  const source = readDotEnv(filePath)
  if (source === null) return { filePath, loadedKeys: [] }
  const loadedKeys = []
  for (const [key, value] of parseDotEnv(source)) {
    if (target[key] !== undefined) continue
    target[key] = value
    loadedKeys.push(key)
  }
  return { filePath, loadedKeys }
}

const useDefaultUrl = (target, key, fallbacks, value) => {
  if (target[key] === undefined || fallbacks.includes(target[key])) target[key] = value
}

export const applyDungeonUrlDefaults = (target = process.env) => {
  const apiPort = target.DUNGEON_API_PORT ?? '4410'
  const webPort = target.DUNGEON_WEB_PORT ?? '4400'
  useDefaultUrl(
    target,
    'DUNGEON_API_URL',
    ['http://127.0.0.1:4410', 'http://localhost:4410'],
    `http://127.0.0.1:${apiPort}`,
  )
  useDefaultUrl(
    target,
    'DUNGEON_WS_URL',
    ['ws://127.0.0.1:4410/ws', 'ws://localhost:4410/ws'],
    `ws://127.0.0.1:${apiPort}/ws`,
  )
  useDefaultUrl(
    target,
    'DUNGEON_WEB_URL',
    ['http://127.0.0.1:4400', 'http://localhost:4400'],
    `http://127.0.0.1:${webPort}`,
  )
  return target
}

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`

export const shellAssignments = (values, existing = process.env) =>
  [...values]
    .filter(([key]) => existing[key] === undefined)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n')

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === modulePath) {
  const existing = { ...process.env }
  const target = { ...existing }
  loadDungeonEnv(target)
  applyDungeonUrlDefaults(target)
  if (process.argv.includes('--shell')) {
    process.stdout.write(`${shellAssignments(Object.entries(target), existing)}\n`)
  }
}
