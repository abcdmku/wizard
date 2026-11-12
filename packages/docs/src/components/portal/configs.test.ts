import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { Backend } from '../../../../dev/src/ui/backend'
import { localBackend } from '../../../../dev/src/ui/local'
import { portals } from './configs'

const pages = fileURLToPath(new URL('../../../pages', import.meta.url))
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

/**
 * Plays a run the way a reader who only presses the main button would: every editor is sent
 * as it opened. Returns the status the run ends with.
 */
async function press(backend: Backend, id: string): Promise<string> {
  for (let round = 0; round < 40; round++) {
    await tick()
    const run = await backend.run(id)
    if (run === undefined) return 'gone'
    if (run.result !== undefined) return run.result.status
    const item = run.pending[0]
    if (item === undefined) {
      if (run.nextTimer === undefined) return run.status
      await backend.act(id, { type: 'skipTimer' })
    } else if (item.kind === 'call') {
      await backend.act(id, { type: 'resolve', id: item.id, value: item.example })
    } else if (item.kind === 'view') {
      const sent = await backend.act(id, {
        type: 'submit',
        path: item.path,
        step: item.step,
        input: item.draft,
      })
      if (!sent.ok) return 'refused'
    } else if (item.kind === 'event') {
      const event = item.events[0]
      await backend.act(id, { type: 'send', event: event?.name ?? '', payload: event?.example })
    } else if (item.kind === 'sleep') await backend.act(id, { type: 'skipTimer' })
    else return 'halted'
  }
  return 'stuck'
}

const wizards = Object.entries(portals).flatMap(([name, spec]) =>
  spec.config.wizards.map((dev) => [name, dev.wizard.name, spec] as const),
)

it.each(wizards)(
  '%s: %s finishes when every editor is sent as it opened',
  async (name, wizard, spec) => {
    const backend = localBackend(spec.config, spec.file)
    const info = (await backend.catalog()).wizards.find((item) => item.name === wizard)
    expect(info?.manifest.warnings).toEqual([])
    const started = await backend.start({ wizard, input: info?.exampleInput })
    expect(started).toMatchObject({ ok: true })
    // The forms page opens with an address the schema refuses, which is its first lesson.
    expect(await press(backend, started.id as string)).toBe(name === 'forms' ? 'refused' : 'done')
  },
)

it('every portal says what to try', () => {
  for (const [name, spec] of Object.entries(portals)) {
    expect(spec.tries.length, name).toBeGreaterThan(1)
  }
})
