import { describe, expect, it } from 'vitest'
import { runDeploymentProbe } from './deployment-probe'

describe('provider-neutral deployment host', () => {
  it('runs the same typed flow before any provider preset is selected', async () => {
    const response = await runDeploymentProbe({ requestId: 'request-42' })

    expect(response).toMatchObject({
      ok: true,
      result: {
        status: 'done',
        output: { requestId: 'request-42', status: 'accepted' },
      },
    })
  })

  it('rejects unknown input at the HTTP boundary', async () => {
    const response = await runDeploymentProbe({ requestId: '' })

    expect(response.ok).toBe(false)
  })
})
