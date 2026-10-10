/**
 * Run the transpiled playground files as REAL ES modules in the page: every file becomes a
 * `blob:` module whose relative imports point at the other files' blob URLs, and bare imports
 * (`@openwizard/core`, `zod`, …) point at tiny generated shims that re-export the host's own
 * module objects. No bundler, no eval of stringly-typed code paths — the browser links it.
 */

export type HostModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export interface LinkedModules {
  /** File name → the module namespace after evaluation (the entry's top-level code has run). */
  readonly namespaces: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

declare global {
  // The generated shim modules read the host module objects from here while they evaluate.
  var __owSandboxHost: HostModules | undefined
}

const FROM_RE = /((?:^|[;\n\s])(?:import|export)\b[^'"`;]*?\bfrom\s*)(['"])([^'"\n]+)\2/g
const BARE_RE = /((?:^|[;\n\s])import\s*)(['"])([^'"\n]+)\2/g
const DYNAMIC_RE = /(\bimport\s*\(\s*)(['"])([^'"\n]+)\2(\s*\))/g

function specifiersOf(source: string): string[] {
  const found = new Set<string>()
  for (const re of [FROM_RE, BARE_RE, DYNAMIC_RE]) {
    for (const match of source.matchAll(re)) if (match[3]) found.add(match[3])
  }
  return [...found]
}

/** `./flow`, `./flow.js`, `./flow.ts` (from any file) → `flow.ts` when that file exists. */
function resolveRelative(specifier: string, files: ReadonlySet<string>): string | null {
  const stem = specifier.replace(/^\.\//, '').replace(/\.(js|ts|tsx|mjs)$/, '')
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`]) if (files.has(candidate)) return candidate
  return null
}

const isIdentifierName = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name)

/**
 * `export { __e0 as catch }` — the `as` form takes any IdentifierName, so exports named like
 * reserved words (`zod` has `catch`, `function`, `enum`, `null`, `void`, …) stay valid.
 */
function shimSource(specifier: string, host: Readonly<Record<string, unknown>>): string {
  const names = Object.keys(host).filter((key) => key !== 'default' && isIdentifierName(key))
  const lines = [`const __h = globalThis.__owSandboxHost[${JSON.stringify(specifier)}];`]
  for (const [index, key] of names.entries())
    lines.push(`const __e${index} = __h[${JSON.stringify(key)}];`)
  lines.push(`export { ${names.map((key, index) => `__e${index} as ${key}`).join(', ')} };`)
  lines.push('export default ("default" in __h ? __h.default : __h);')
  return lines.join('\n')
}

const blobUrl = (source: string) =>
  URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))

/** Post-order over the user files' import graph so every dependency has a URL before its importer. */
function evaluationOrder(entry: string, modules: ReadonlyMap<string, string>): string[] {
  const files = new Set(modules.keys())
  const order: string[] = []
  const state = new Map<string, 'open' | 'done'>()
  const visit = (file: string, chain: string[]) => {
    const current = state.get(file)
    if (current === 'done') return
    if (current === 'open')
      throw new Error(
        `Circular imports are not supported in the playground: ${[...chain, file].join(' → ')}`,
      )
    state.set(file, 'open')
    for (const spec of specifiersOf(modules.get(file) ?? '')) {
      if (!spec.startsWith('.')) continue
      const target = resolveRelative(spec, files)
      if (target === null)
        throw new Error(
          `${file}: cannot resolve import '${spec}' — only files of this playground and its packages can be imported`,
        )
      visit(target, [...chain, file])
    }
    state.set(file, 'done')
    order.push(file)
  }
  visit(entry, [])
  for (const file of files) visit(file, [])
  return order
}

export async function linkAndImport(
  modules: ReadonlyMap<string, string>,
  entry: string,
  host: HostModules,
): Promise<LinkedModules> {
  const files = new Set(modules.keys())
  const urls = new Map<string, string>()
  const created: string[] = []
  const urlFor = (specifier: string, from: string): string => {
    if (specifier.startsWith('.')) {
      const target = resolveRelative(specifier, files)
      const url = target === null ? undefined : urls.get(target)
      if (!url) throw new Error(`${from}: cannot resolve import '${specifier}'`)
      return url
    }
    const hostModule = host[specifier]
    if (!hostModule) {
      throw new Error(
        `${from}: cannot import '${specifier}' — the playground provides ${Object.keys(host).join(', ')} and the files on the left`,
      )
    }
    let url = urls.get(`host:${specifier}`)
    if (!url) {
      url = blobUrl(shimSource(specifier, hostModule))
      urls.set(`host:${specifier}`, url)
      created.push(url)
    }
    return url
  }

  globalThis.__owSandboxHost = host
  try {
    const order = evaluationOrder(entry, modules)
    for (const file of order) {
      const rewritten = (modules.get(file) ?? '')
        .replace(
          FROM_RE,
          (_m, head: string, quote: string, spec: string) =>
            `${head}${quote}${urlFor(spec, file)}${quote}`,
        )
        .replace(
          BARE_RE,
          (_m, head: string, quote: string, spec: string) =>
            `${head}${quote}${urlFor(spec, file)}${quote}`,
        )
        .replace(
          DYNAMIC_RE,
          (_m, head: string, quote: string, spec: string, tail: string) =>
            `${head}${quote}${urlFor(spec, file)}${quote}${tail}`,
        )
      const url = blobUrl(rewritten)
      urls.set(file, url)
      created.push(url)
    }
    const namespaces = new Map<string, Readonly<Record<string, unknown>>>()
    // Importing the entry evaluates the whole graph; the others are then cached instances.
    for (const file of [entry, ...order.filter((file) => file !== entry)]) {
      const url = urls.get(file)
      if (url)
        namespaces.set(
          file,
          (await import(/* @vite-ignore */ url)) as Readonly<Record<string, unknown>>,
        )
    }
    return { namespaces }
  } finally {
    for (const url of created) URL.revokeObjectURL(url)
  }
}
