import { createRun, defineFlow } from '@openwizard/core'
import { defineHandler } from 'nitro'
import { z } from 'zod'

const Request = z.object({ requestId: z.string().min(1) })
const probe = defineFlow({ name: 'probe', context: Request })
const probeFlow = probe.steps({
  accept: probe.task(({ context }) => context.requestId, { next: 'done' }),
  done: probe.final({ output: ({ context }) => ({ accepted: context.requestId }) }),
})

export default defineHandler(async (event) => {
  const input = Request.safeParse(await event.req.json())
  if (!input.success) {
    return new Response(JSON.stringify({ issues: input.error.issues }), { status: 400 })
  }

  const run = createRun(probeFlow, { context: input.data })
  try {
    await run.start()
    return await run.awaitResult()
  } finally {
    run.dispose()
  }
})
