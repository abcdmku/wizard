import { defineHandler } from 'nitro'
import { runDeploymentProbe } from '../../../src/deployment-probe'

export default defineHandler(async (event) => {
  const response = await runDeploymentProbe(await event.req.json())

  if (!response.ok) {
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  return response
})
