import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const DeploymentRequest = z.object({
  requestId: z.string().min(1),
})

export const deploymentProbe = defineWizard(
  {
    name: 'deployment-probe',
    description: 'Accepts a request id and echoes it, to prove a deployed build can run a wizard.',
    context: DeploymentRequest,
  },
  ({ step, steps }) =>
    steps({
      accept: step({
        run: ({ context }) => ({ accepted: context.requestId }),
        next: 'done',
      }),
      done: step({
        run: ({ context }) => ({
          requestId: context.requestId,
          status: 'accepted' as const,
        }),
      }),
    }),
)

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

  return { ok: true as const, result: await deploymentProbe.run(request.data) }
}
