/**
 * Shared helper: enumerate the packages, their public ENTRIES (one per `exports` subpath in
 * package.json — `.` → `src/index.ts`, `./testing` → `src/testing.ts`) and the exports of each
 * entry, using the TypeScript compiler API (so re-exports and type-only exports are resolved
 * exactly like the compiler sees them).
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')

export const ROOT = resolve(import.meta.dirname, '..', '..')
export const PACKAGES_DIR = join(ROOT, 'packages')

/**
 * @typedef {{
 *   specifier: string,   // what a consumer imports: '@openwizard/core' | '@openwizard/core/testing'
 *   subpath: string,     // the package.json exports key: '.' | './testing'
 *   slug: string,        // file-name friendly id: 'core' | 'core-testing'
 *   indexPath: string,   // packages/<pkg>/src/<entry>.ts
 *   dtsPath: string,     // packages/<pkg>/dist/<entry>.d.ts (after `pnpm build`)
 * }} Entry
 */

/** @returns {Array<{ dir: string, name: string, entries: Entry[], indexPath: string }>} */
export function listPackages() {
  return readdirSync(PACKAGES_DIR)
    .map((d) => join(PACKAGES_DIR, d))
    .filter(
      (dir) => existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'index.ts')),
    )
    .map((dir) => {
      const pkg = require(join(dir, 'package.json'))
      const short = pkg.name.replace('@openwizard/', '')
      // Public code entries only: `./package.json` and asset subpaths (`./style.css`) are not
      // TypeScript surfaces.
      const exportsMap = pkg.exports ?? { '.': true }
      const subpaths = Object.keys(exportsMap).filter((key) => {
        if (key === './package.json') return false
        const target = exportsMap[key]
        return typeof target !== 'string' || /\.(m?js|cjs|ts)$/.test(target)
      })
      const entries = subpaths.map((subpath) => {
        const entry = subpath === '.' ? 'index' : subpath.replace(/^\.\//, '')
        return {
          specifier: subpath === '.' ? pkg.name : `${pkg.name}/${entry}`,
          subpath,
          slug: subpath === '.' ? short : `${short}-${entry.replaceAll('/', '-')}`,
          indexPath: join(dir, 'src', `${entry}.ts`),
          dtsPath: join(dir, 'dist', `${entry}.d.ts`),
        }
      })
      return { dir, name: pkg.name, entries, indexPath: join(dir, 'src', 'index.ts') }
    })
}

/**
 * @typedef {{ name: string, kind: string, summary: string, tags: string[], file: string, line: number, typeOnly: boolean }} ExportInfo
 */

/** @returns {ExportInfo[]} */
export function collectExports(indexPath) {
  const tsconfigPath = ts.findConfigFile(indexPath, ts.sys.fileExists, 'tsconfig.json')
  const config = tsconfigPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(tsconfigPath, ts.sys.readFile).config,
        ts.sys,
        resolve(tsconfigPath, '..'),
      )
    : { options: { strict: true }, fileNames: [] }
  const program = ts.createProgram({
    rootNames: [indexPath],
    options: { ...config.options, noEmit: true },
  })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(indexPath)
  if (!sf) throw new Error(`cannot load ${indexPath}`)
  const moduleSymbol = checker.getSymbolAtLocation(sf)
  if (!moduleSymbol) return []
  const out = []
  for (const sym of checker.getExportsOfModule(moduleSymbol)) {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
    const decl = (target.declarations ?? sym.declarations ?? [])[0]
    const kind = describeKind(target, decl)
    const summary =
      ts.displayPartsToString(target.getDocumentationComment(checker)).split('\n')[0]?.trim() ?? ''
    const tags = target.getJsDocTags(checker).map((t) => t.name)
    const file = decl ? decl.getSourceFile().fileName : ''
    const line = decl
      ? decl.getSourceFile().getLineAndCharacterOfPosition(decl.getStart()).line + 1
      : 0
    const typeOnly = !(
      target.flags &
      (ts.SymbolFlags.Value |
        ts.SymbolFlags.Function |
        ts.SymbolFlags.Class |
        ts.SymbolFlags.Variable |
        ts.SymbolFlags.Enum)
    )
    out.push({ name: sym.getName(), kind, summary, tags, file, line, typeOnly })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function describeKind(symbol, decl) {
  const f = symbol.flags
  if (f & ts.SymbolFlags.Function) return 'function'
  if (f & ts.SymbolFlags.Class) return 'class'
  if (f & ts.SymbolFlags.Interface) return 'interface'
  if (f & ts.SymbolFlags.TypeAlias) return 'type'
  if (f & ts.SymbolFlags.Enum) return 'enum'
  if (f & ts.SymbolFlags.Variable)
    return decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      ts.isArrowFunction(decl.initializer)
      ? 'function'
      : 'const'
  if (f & ts.SymbolFlags.Namespace) return 'namespace'
  return 'unknown'
}
