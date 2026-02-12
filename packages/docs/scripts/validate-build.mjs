#!/usr/bin/env node

import { createServer } from 'node:http'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const docsRoot = join(__dirname, '..')
const distClientDir = join(docsRoot, 'dist/client')

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
  '.wasm': 'application/wasm',
}

const searchSmokeCases = [
  {
    term: 'createWizardFactory',
    expected: /createwizardfactory/i,
  },
  {
    term: 'useWizardStep',
    expected: /usewizardstep/i,
  },
  {
    term: 'TanStack Router',
    expected: /(tanstackwizardrouter|react-router|routing)/i,
  },
]

function log(color, ...args) {
  console.log(color, ...args, colors.reset)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function toHtmlPath(routePath) {
  if (routePath === '/') {
    return 'index.html'
  }
  const normalized = routePath.replace(/^\/+/, '').replace(/\/+$/, '')
  return `${normalized}/index.html`
}

async function readPrerenderPaths() {
  const pathsFile = join(docsRoot, 'src/generated/prerender-pages.json')
  if (!(await exists(pathsFile))) {
    throw new Error('Missing src/generated/prerender-pages.json. Run `pnpm run generate:manifest` first.')
  }

  const content = await readFile(pathsFile, 'utf8')
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid prerender pages file. Expected an array of route paths.')
  }
  return parsed
}

async function validateStaticOutput(prerenderPages) {
  log(colors.blue, '\n[validate-build] Checking static output...')
  if (!(await exists(distClientDir))) {
    throw new Error('Missing dist/client. Run `pnpm run build:site` first.')
  }

  const missingPages = []

  for (const routePath of prerenderPages) {
    const htmlPath = join(distClientDir, toHtmlPath(routePath))
    if (!(await exists(htmlPath))) {
      missingPages.push(routePath)
    }
  }

  if (missingPages.length > 0) {
    throw new Error(
      `Missing prerendered HTML files for routes:\n${missingPages.map((route) => `- ${route}`).join('\n')}`,
    )
  }

  log(colors.green, `[validate-build] Static prerender output OK (${prerenderPages.length} routes)`)
}

async function validateTypeDoc() {
  log(colors.blue, '\n[validate-build] Checking embedded TypeDoc...')
  const typedocIndex = join(distClientDir, 'typedoc/index.html')
  if (!(await exists(typedocIndex))) {
    throw new Error('Missing dist/client/typedoc/index.html. API docs were not copied into static output.')
  }

  const html = await readFile(typedocIndex, 'utf8')
  const markers = ['Wizard API Documentation', '@wizard/core', '@wizard/react']
  for (const marker of markers) {
    if (!html.includes(marker)) {
      log(colors.yellow, `[validate-build] Warning: TypeDoc index missing marker "${marker}"`)
    }
  }

  log(colors.green, '[validate-build] TypeDoc embed OK')
}

async function validateSearchIndex() {
  log(colors.blue, '\n[validate-build] Checking Pagefind index...')
  const pagefindDir = join(distClientDir, 'pagefind')
  const requiredFiles = ['pagefind.js', 'pagefind-entry.json']

  if (!(await exists(pagefindDir))) {
    throw new Error('Missing dist/client/pagefind. Run `pnpm run build:search` after site build.')
  }

  const missingFiles = []
  for (const file of requiredFiles) {
    const fullPath = join(pagefindDir, file)
    if (!(await exists(fullPath))) {
      missingFiles.push(file)
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `Incomplete Pagefind index. Missing files:\n${missingFiles.map((file) => `- ${file}`).join('\n')}`,
    )
  }

  log(colors.green, '[validate-build] Pagefind index OK')
}

async function startStaticServer(siteRoot) {
  const normalizedRoot = normalize(siteRoot).toLowerCase()

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      let pathname = decodeURIComponent(requestUrl.pathname)

      if (pathname === '/') {
        pathname = '/index.html'
      }

      const relativePath = pathname.replace(/^\/+/, '')
      let fullPath = normalize(join(siteRoot, relativePath))
      if (!fullPath.toLowerCase().startsWith(normalizedRoot)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      let fileStat
      try {
        fileStat = await stat(fullPath)
      } catch {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      if (fileStat.isDirectory()) {
        fullPath = join(fullPath, 'index.html')
      }

      const file = await readFile(fullPath)
      const contentType = mimeTypes[extname(fullPath)] ?? 'application/octet-stream'
      response.writeHead(200, { 'content-type': contentType })
      response.end(file)
    } catch (error) {
      response.writeHead(500)
      response.end(error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine local server address for search smoke checks.')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

async function validateSearchQueries() {
  log(colors.blue, '\n[validate-build] Running Pagefind query smoke tests...')

  const pagefindModulePath = join(distClientDir, 'pagefind/pagefind.js')
  if (!(await exists(pagefindModulePath))) {
    throw new Error('Cannot run search smoke tests: missing dist/client/pagefind/pagefind.js')
  }

  const { origin, close } = await startStaticServer(distClientDir)
  const pagefindModuleUrl = pathToFileURL(pagefindModulePath).href
  const pagefind = await import(pagefindModuleUrl)

  try {
    await pagefind.options({
      basePath: `${origin}/pagefind/`,
      baseUrl: origin,
    })

    for (const searchCase of searchSmokeCases) {
      const response = await pagefind.search(searchCase.term)
      if (!response || response.results.length === 0) {
        throw new Error(`Search smoke test failed: no results for "${searchCase.term}"`)
      }

      const hydratedResults = await Promise.all(
        response.results.slice(0, 8).map((result) => result.data()),
      )
      const matchesExpectation = hydratedResults.some((result) => {
        const title = result.meta?.title ?? ''
        const candidate = `${title} ${result.url}`
        return searchCase.expected.test(candidate)
      })

      if (!matchesExpectation) {
        const topUrls = hydratedResults.map((result) => result.url).join(', ')
        throw new Error(
          `Search smoke test failed for "${searchCase.term}". Top results did not match expectation. Results: ${topUrls}`,
        )
      }
    }

    log(colors.green, '[validate-build] Pagefind query smoke tests OK')
  } finally {
    if (typeof pagefind.destroy === 'function') {
      await pagefind.destroy()
    }
    await close()
  }
}

async function generateReport(prerenderPages, searchQuerySmokePassed) {
  const report = {
    timestamp: new Date().toISOString(),
    staticSite: {
      clientBuilt: await exists(join(docsRoot, 'dist/client')),
      serverBundleBuilt: await exists(join(docsRoot, 'dist/server/server.js')),
      prerenderPages: prerenderPages.length,
    },
    typedoc: {
      embedded: await exists(join(docsRoot, 'dist/client/typedoc/index.html')),
    },
    search: {
      pagefindIndexed: await exists(join(docsRoot, 'dist/client/pagefind/pagefind-entry.json')),
      querySmokePassed: searchQuerySmokePassed,
    },
    pages: {
      sourceMdxCount: 0,
      prerenderedHtmlCount: 0,
    },
  }

  const sourceFiles = await readdir(join(docsRoot, 'pages'), { recursive: true })
  report.pages.sourceMdxCount = sourceFiles.filter(
    (file) => file.endsWith('.mdx') && !file.includes('\\_') && !file.includes('/_'),
  ).length

  const builtFiles = await readdir(distClientDir, { recursive: true })
  report.pages.prerenderedHtmlCount = builtFiles.filter((file) => file.endsWith('.html')).length

  const reportPath = join(docsRoot, 'build-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  log(colors.green, `[validate-build] Wrote build report: ${reportPath}`)

  return report
}

async function main() {
  try {
    const prerenderPages = await readPrerenderPaths()
    await validateStaticOutput(prerenderPages)
    await validateTypeDoc()
    await validateSearchIndex()
    await validateSearchQueries()

    const report = await generateReport(prerenderPages, true)
    log(
      colors.green,
      '\n[validate-build] Build validation passed.',
      `(prerendered routes: ${report.staticSite.prerenderPages})`,
    )
  } catch (error) {
    log(colors.red, '\n[validate-build] Build validation failed.')
    log(colors.red, error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
