import { describe, expect, it } from 'vitest'
import type { Issue } from '../../src/machine/state'
import { createHarness, flow, routingStep, view } from '../helpers/fixtures'

const issues: readonly Issue[] = [
  { message: 'name required', path: ['name'] },
  { message: 'email required', path: [{ key: 'email' }] },
  { message: 'street required', path: [{ key: 'address' }, 'street'] },
  { message: 'address country invalid', path: ['address', 'country'] },
  { message: 'first item required', path: ['items', 0, 'name'] },
  { message: 'form incomplete' },
  { message: 'values conflict', path: [] },
]

function invalidForm() {
  const h = createHarness(
    flow({
      start: 'form',
      steps: {
        form: view({
          next: 'done',
          input: {
            kind: 'guard',
            parse: () => ({ ok: false, issues }),
          },
        }),
        done: routingStep(),
      },
    }),
  )
  h.start()
  h.cmd('next')
  h.err(h.call('parseInput'), 'invalid', { issues })
  expect(h.rec('form').issues).toEqual(issues)
  return h
}

describe('input patch validation issues', () => {
  it('clears changed fields and nested descendants while retaining unrelated and global issues', () => {
    const h = invalidForm()
    h.cmd({ type: 'setInput', step: 'form', patch: { name: 'Ada' } })
    expect(h.rec('form').issues).toEqual(issues.slice(1))
    h.cmd({ type: 'setInput', step: 'form', patch: { address: { street: 'Main' }, items: [] } })
    expect(h.rec('form').issues).toEqual([issues[1], issues[5], issues[6]])
    h.cmd({ type: 'setInput', step: 'form', patch: { email: 'ada@example.com' } })
    expect(h.rec('form').issues).toEqual([issues[5], issues[6]])
    expect(h.rec('form').input).toEqual({
      name: 'Ada',
      address: { street: 'Main' },
      items: [],
      email: 'ada@example.com',
    })
  })

  it('keeps issues for empty patches and replaces them on the next validation transaction', () => {
    const h = invalidForm()
    h.cmd({ type: 'setInput', step: 'form', patch: {} })
    expect(h.rec('form').issues).toEqual(issues)
    h.cmd({ type: 'setInput', step: 'form', patch: { name: 'Ada' } })
    h.cmd('next')
    const replacement: readonly Issue[] = [{ message: 'only email required', path: ['email'] }]
    h.err(h.call('parseInput'), 'still invalid', { issues: replacement })
    expect(h.rec('form').issues).toEqual([{ message: 'only email required', path: ['email'] }])
    expect(h.state.current).toBe('form')
    expect(h.state.nav.phase).toBe('idle')
  })

  it('clears all issues when the entire input is replaced or reset', () => {
    for (const command of [
      { type: 'setInput', step: 'form', patch: 'whole replacement' },
      { type: 'resetInput', step: 'form' },
    ] as const) {
      const h = invalidForm()
      h.cmd(command)
      expect(h.rec('form').issues).toBeUndefined()
    }
  })
})
