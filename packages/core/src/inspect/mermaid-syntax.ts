/**
 * Mermaid text primitives: unique safe identifiers, quoted labels, node shapes and durations.
 * @internal
 */

import type { ManifestStep } from './types'

const RESERVED = new Set([
  'end',
  'graph',
  'subgraph',
  'flowchart',
  'style',
  'classdef',
  'class',
  'click',
  'linkstyle',
  'direction',
])

/** Stable, unique, Mermaid-safe identifiers for (path, id) pairs. */
export class Ids {
  private readonly byKey = new Map<string, string>()
  private readonly taken = new Set<string>()

  of(segments: readonly string[]): string {
    const k = JSON.stringify(segments)
    const existing = this.byKey.get(k)
    if (existing !== undefined) return existing
    let base = segments.map(sanitize).join('__')
    if (base.length === 0 || /^[0-9]/.test(base)) base = `n_${base}`
    if (RESERVED.has(base.toLowerCase())) base = `${base}_`
    let candidate = base
    for (let n = 2; this.taken.has(candidate); n += 1) candidate = `${base}_${n}`
    this.taken.add(candidate)
    this.byKey.set(k, candidate)
    return candidate
  }
}

function sanitize(segment: string): string {
  return segment.replace(/^\$/, '_').replace(/[^A-Za-z0-9_]/g, '_')
}

/**
 * Mermaid entity codes for the characters that would end (`"`), break (`;`, `[` / `]`, `|`) or
 * reinterpret (`&`, `<`, `>`, `#` — HTML / entity syntax) a quoted label.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  '"': '#quot;',
  '&': '#amp;',
  '<': '#lt;',
  '>': '#gt;',
  '#': '#35;',
  ';': '#59;',
  '[': '#91;',
  ']': '#93;',
  '|': '#124;',
}

/**
 * A quoted Mermaid label: line breaks become spaces (a raw CR / LF ends the statement), every
 * entity / syntax character becomes a Mermaid entity code, and `lines` are joined with `<br/>`.
 */
export function quote(...lines: readonly string[]): string {
  const safe = lines.map((line) =>
    line.replace(/\r\n|\r|\n/g, ' ').replace(/["&<>#;[\]|]/g, (c) => ENTITIES[c] ?? c),
  )
  return `"${safe.join('<br/>')}"`
}

/** A node declaration's shape around its quoted text: view `[…]`, step `[[…]]`, child `[/…/]`. */
export function shape(kind: ManifestStep['kind'], text: string): string {
  switch (kind) {
    case 'view':
      return `[${text}]`
    case 'step':
      return `[[${text}]]`
    case 'child':
      return `[/${text}/]`
  }
}

/** `900000` → `15m`; falls back to the largest whole unit, else `ms`. */
export function duration(ms: number): string {
  const units: ReadonlyArray<readonly [suffix: string, size: number]> = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ]
  for (const [suffix, size] of units)
    if (ms >= size && ms % size === 0) return `${ms / size}${suffix}`
  return `${ms}ms`
}
