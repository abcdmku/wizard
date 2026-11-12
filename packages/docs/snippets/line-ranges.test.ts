import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

/** Pages show these files through `lines="..."`. A shifted line would show the wrong code. */
const linesOf = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n')
    .split('\n')

it('the Quickstart and the landing page hide only the lint comment of factory.ts (lines="1-10,12-13")', () => {
  const lines = linesOf('./learn/factory.ts')

  expect(lines[10]).toContain('biome-ignore')
  expect(lines[11]).toContain('console.log(result.output)')
  expect(lines[12]).toBe('}')
  expect(lines.slice(13).join('')).toBe('')
})

it('the Effect page shows the first wizard and the runtime (lines="1-34" and "63-70")', () => {
  const lines = linesOf('../../effect/snippets/basic.ts')

  expect(lines[0]).toContain("from '@openwizard/core'")
  expect(lines[33]).toBe(')')
  expect(lines[35]).toContain('export const batchCheckout')
  expect(lines[62]).toContain('One runtime for the application')
  expect(lines[69]).toContain('export const charge =')
})
