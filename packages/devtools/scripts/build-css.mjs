#!/usr/bin/env node
/**
 * Assemble `dist/style.css`: React Flow's stylesheet (the base it needs to render, MIT) followed
 * by the devtools' own sheets (`src/styles/*.css`, theme first), so a consumer imports ONE file:
 * `import '@openwizard/devtools/style.css'`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)
const reactFlowCss = readFileSync(require.resolve('@xyflow/react/dist/style.css'), 'utf8')
/** In cascade order: the theme (variables + shared bits) before the component sheets. */
const OWN = ['theme', 'graph', 'log', 'inspector', 'timeline', 'panel']
const ownCss = OWN.map((name) =>
  readFileSync(join(root, 'src', 'styles', `${name}.css`), 'utf8'),
).join('\n')

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(
  join(root, 'dist', 'style.css'),
  `/* @openwizard/devtools — bundled with @xyflow/react/dist/style.css (MIT, © xyflow) */\n${reactFlowCss}\n\n${ownCss}`,
)
console.log('[devtools] wrote dist/style.css')
