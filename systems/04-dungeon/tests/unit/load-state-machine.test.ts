import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('passes the load state-machine checks', () => {
  const suites = ['state-machine.test.mjs', 'k6-summary.test.mjs'].map((file) =>
    fileURLToPath(new URL(`../../load/${file}`, import.meta.url)),
  )
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...suites], {
    encoding: 'utf8',
  })
  expect(output).toContain('# fail 0')
})
