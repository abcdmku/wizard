import { expect, it } from 'vitest'
import { localBackend } from '../src/ui/local'
import config from './fixture'

it('runs the wizards of a config in memory, with no server', async () => {
  const backend = localBackend(config, 'fixture')
  expect(backend.place).toBe('page')
  expect(backend.reload).toBeUndefined()
  const catalog = await backend.catalog()
  expect(catalog.entry).toBe('fixture')
  expect(catalog.wizards.map((wizard) => wizard.name)).toEqual(['refund', 'reminder'])

  const notices: (string | undefined)[] = []
  const stop = backend.subscribe(
    (notice) => notices.push(notice.run),
    () => {},
  )
  const started = await backend.start({ wizard: 'refund', input: { orderId: 'o-1' } })
  expect(started.ok).toBe(true)
  const id = started.id as string

  const run = await backend.run(id)
  expect(run?.pending.map((item) => item.kind).sort()).toEqual(['call', 'view'])
  expect(
    await backend.act(id, { type: 'submit', path: [], step: 'request', input: { amount: 20 } }),
  ).toEqual({ ok: true })
  expect(notices).toContain(id)
  expect((await backend.runs()).map((item) => item.id)).toEqual([id])

  expect(await backend.remove(id)).toBe(true)
  expect(await backend.run(id)).toBeUndefined()
  stop()
})
