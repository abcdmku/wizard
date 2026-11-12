import { expect, it } from 'vitest'
import { createManualDeps } from '../src/server/manual-deps'

interface Deps {
  orders: { find(id: string): Promise<{ total: number }> }
  mail: { send(to: string): Promise<string> }
}

it('records a call by its path and settles it with the value a person gives', async () => {
  let changes = 0
  const manual = createManualDeps(() => changes++)
  const found = (manual.deps as Deps).orders.find('o-1')

  expect(manual.pending()).toEqual([{ id: 'call-1', name: 'orders.find', args: ['o-1'] }])
  expect(manual.resolve('call-1', { total: 40 })).toBe(true)
  await expect(found).resolves.toEqual({ total: 40 })
  expect(manual.pending()).toEqual([])
  expect(manual.resolve('call-1', {})).toBe(false)
  expect(changes).toBe(2)
})

it('rejects a call with the message a person gives', async () => {
  const manual = createManualDeps(() => {})
  const sent = (manual.deps as Deps).mail.send('ada@example.com')
  manual.reject('call-1', 'Mailbox full')
  await expect(sent).rejects.toThrow('Mailbox full')
})

it('uses a real service when one exists and waits only for the missing ones', async () => {
  const manual = createManualDeps(() => {}, { mail: { send: async (to: string) => `sent ${to}` } })
  const deps = manual.deps as Deps
  await expect(deps.mail.send('ada@example.com')).resolves.toBe('sent ada@example.com')
  void deps.orders.find('o-1')
  expect(manual.pending().map((call) => call.name)).toEqual(['orders.find'])
})

it('is not mistaken for a promise', async () => {
  const manual = createManualDeps(() => {})
  expect(await manual.deps).toBe(manual.deps)
})
