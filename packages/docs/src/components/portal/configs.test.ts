import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { localBackend } from '../../../../dev/src/ui/local'
import { portals } from './configs'

const pages = fileURLToPath(new URL('../../../pages', import.meta.url))

it('has a portal for every name a page asks for', () => {
  const names = new Set<string>()
  for (const file of readdirSync(pages, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.mdx')) continue
    const text = readFileSync(`${pages}/${file}`, 'utf8')
    for (const match of text.matchAll(/<Portal name="([^"]+)" \/>/g)) names.add(match[1] as string)
  }
  expect(names.size).toBeGreaterThan(8)
  for (const name of names) expect(portals, name).toHaveProperty(name)
})

it.each(Object.entries(portals))('loads and starts a run in the %s portal', async (_name, spec) => {
  const backend = localBackend(spec.config, spec.file)
  const catalog = await backend.catalog()
  expect(catalog.error).toBeUndefined()
  expect(catalog.wizards.length).toBeGreaterThan(0)
  for (const wizard of catalog.wizards) {
    const started = await backend.start({ wizard: wizard.name, input: wizard.exampleInput })
    expect(started, wizard.name).toMatchObject({ ok: true })
    const run = await backend.run(started.id as string)
    // A run that needs nothing from outside finishes on its own. Every other one waits.
    expect(run?.result !== undefined || (run?.pending.length ?? 0) > 0, wizard.name).toBe(true)
    await backend.remove(started.id as string)
  }
})
