import { createRun, defineFlow } from '@openwizard/core'
import { z } from 'zod'

export const DeploymentRequest = z.object({
  requestId: z.string().min(1),
})

const deploymentProbe = defineFlow({
  name: 'deployment-probe',
  context: DeploymentRequest,
})

export const deploymentProbeFlow = deploymentProbe.steps({
  accept: deploymentProbe.task(({ context }) => ({ accepted: context.requestId }), {
    next: 'done',
  }),
  done: deploymentProbe.final({
    output: ({ context }) => ({ requestId: context.requestId, status: 'accepted' as const }),
  }),
})

export async function runDeploymentProbe(input: unknown) {
  const request = DeploymentRequest.safeParse(input)
  if (!request.success) {
    return {
      ok: false as const,
      issues: request.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String),
      })),
    }
  }

  const run = createRun(deploymentProbeFlow, { context: request.data })
  await run.start()

  return { ok: true as const, result: await run.awaitResult() }
}
