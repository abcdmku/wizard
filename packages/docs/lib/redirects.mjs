/**
 * Old routes and the page each one moved to. The site is static, so the build writes one small
 * HTML page per entry (`scripts/postbuild.mjs`), and the docs route follows the same table for
 * links inside the app. A target may carry a `#hash`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const section = (from, to, slugs) =>
  Object.fromEntries([[from, to], ...slugs.map((slug) => [`${from}/${slug}`, `${to}/${slug}`])])

const packageSlugs = [
  'core',
  'react',
  'devtools',
  'dev',
  'durable',
  'drizzle',
  'http',
  'effect',
  'opentelemetry',
]

/** @type {Readonly<Record<string, string>>} old path to new path, both without a trailing slash */
export const redirects = {
  // The sections renamed when the site was redesigned.
  '/getting-started': '/quickstart',
  ...section('/learn', '/guide', [
    'needs',
    'forms',
    'branch',
    'wait',
    'failures',
    'save-resume',
    'children',
    'test',
    'inspect',
  ]),
  ...section('/advanced', '/production', ['server', 'client', 'http', 'tracing']),
  ...section('/packages', '/reference', packageSlugs),

  // Pages that existed before the docs were rewritten to 26 pages.
  ...section('/api', '/reference', packageSlugs),
  '/learn/mental-model': '/guide',
  '/learn/steps': '/guide',
  '/learn/input': '/guide/forms',
  '/learn/events': '/guide/wait',
  '/learn/persistence': '/guide/save-resume',
  '/learn/results': '/quickstart',
  '/learn/testing': '/guide/test',
  '/advanced/graphs': '/guide/needs',
  '/advanced/nested': '/guide/children',
  '/advanced/events': '/guide/wait',
  '/advanced/recovery': '/guide/failures#retry-a-step',
  '/advanced/compensation': '/guide/failures#undo-finished-steps',
  '/advanced/persistence': '/guide/save-resume',
  '/advanced/durability': '/production/server',
  '/advanced/projections': '/production/client',
  '/advanced/operations': '/guide/inspect',
  '/recipes': '/examples',
  '/recipes/form': '/guide/forms',
  '/recipes/branching': '/guide/branch',
  '/recipes/parallel': '/guide/needs',
  '/recipes/nested': '/guide/children',
  '/examples/reference-systems': '/examples#read-a-larger-system',
}

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The HTML served at an old route. `meta refresh` works without JavaScript. The script runs
 * first where it can, and keeps the query and a `#hash` the visitor arrived with.
 *
 * @param {string} target site-absolute path including the deployment base, such as `/wizard/guide`
 */
export function redirectHtml(target) {
  const href = escapeHtml(target)
  const [path, hash = ''] = target.split('#')
  const script = `var l=location;l.replace(${JSON.stringify(path)}+l.search+(l.hash||${JSON.stringify(hash ? `#${hash}` : '')}))`
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>This page has moved</title>',
    '<meta name="robots" content="noindex">',
    `<link rel="canonical" href="${href}">`,
    `<script>${script}</script>`,
    `<meta http-equiv="refresh" content="0; url=${href}">`,
    '</head>',
    '<body>',
    `<p>This page has moved to <a href="${href}">${href}</a>.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Write `<old>/index.html` for every redirect into the built site.
 *
 * @param {string} outDir the published folder, `dist/client`
 * @param {string} base the deployment base path, `/` or `/wizard/`
 * @returns {number} how many pages were written
 */
export function writeRedirectPages(outDir, base) {
  const prefix = base.replace(/\/$/, '')
  for (const [from, to] of Object.entries(redirects)) {
    const dir = resolve(outDir, `.${from}`)
    mkdirSync(dir, { recursive: true })
    const [path, hash] = to.split('#')
    writeFileSync(
      resolve(dir, 'index.html'),
      redirectHtml(`${prefix}${path}/${hash ? `#${hash}` : ''}`),
    )
  }
  return Object.keys(redirects).length
}
