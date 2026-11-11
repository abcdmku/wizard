import { expect, it } from 'vitest'
import { saveAndResume } from './resume'

it('re-arms the remaining timeout after a resume', async () => {
  const { epoch, remaining, result } = await saveAndResume()

  expect(epoch).toBe(1)
  expect(remaining).toBe(1)
  expect(result).toMatchObject({ status: 'done', output: 'expired: nobody decided within 48h' })
})
